const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const logic = require('./game-logic');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

let QRCode = null;
try { QRCode = require('qrcode'); } catch (e) { /* opcjonalne: bez paczki nie ma kodu QR */ }

// ---------- KONFIGURACJA I PYTANIA ----------
let config, rawQuestions;
try {
    config = require('./data/config.json');
    rawQuestions = require('./data/questions.json');
} catch (e) {
    console.error('Brak plików w /data/ (config.json, questions.json):', e.message);
    process.exit(1);
}
const cfg = Object.assign({
    roundTime: 30, bettingTime: 15, resultTime: 10, serverPort: 3000, maxRounds: 10,
    baseChipValue: 100, permChips: 2, writerBonus: 300, maxPlayers: 15, maxNickLength: 16, revealDelay: 2500
}, config);

const allQuestions = logic.cleanQuestions(rawQuestions);
if (allQuestions.length === 0) { console.error('Brak poprawnych pytań w data/questions.json.'); process.exit(1); }
if (allQuestions.length !== rawQuestions.length) {
    console.warn(`Pominięto ${rawQuestions.length - allQuestions.length} wadliwych lub zduplikowanych pytań.`);
}

const PLAYER_COLORS = [
    '#FF0000', '#0066FF', '#00CC00', '#FFD700', '#9900CC',
    '#FF8C00', '#00E5EE', '#FF1493', '#7FFF00', '#008080',
    '#8B4513', '#EE82EE', '#DC143C', '#808000', '#4B0082'
];

const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'hexagon']; // kolor + kształt = unikalna para dla 15 graczy

// ---------- SIEĆ I AUTORYZACJA HOSTA ----------
function lanAddresses() {
    const out = [];
    Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(i => {
        if ((i.family === 'IPv4' || i.family === 4) && !i.internal) out.push(i.address);
    }));
    return out;
}
// Host to zawsze komputer z serwerem: łączenie z localhost albo z własnego adresu LAN.
function isLocalAddress(addr) {
    if (!addr) return false;
    const a = addr.replace('::ffff:', '');
    return a === '127.0.0.1' || a === '::1' || lanAddresses().includes(a);
}

app.use(express.static(path.join(__dirname, 'public')));

let infoCache = null;
app.get('/info', async (req, res) => {
    try {
        if (!infoCache) {
            const urls = lanAddresses().map(ip => `http://${ip}:${cfg.serverPort}`);
            const qr = (QRCode && urls[0]) ? await QRCode.toDataURL(urls[0], { margin: 1, width: 360 }) : null;
            infoCache = { urls, qr };
        }
        res.json(infoCache);
    } catch (e) { res.json({ urls: [], qr: null }); }
});

// ---------- STAN GRY ----------
let players = {};          // publicId -> {id, token, socketId, nick, color, money, connected}
let tokens = {};           // token -> publicId (sekret do reconnectu)
let socketToPlayer = {};   // socket.id -> publicId
let nextPlayerNum = 1;

let phase = 'IDLE';        // IDLE | QUESTION | SHOW_ANSWERS | BETTING | RESULT | FINISHED
let activeQuestions = [];
let qIndex = 0;
let rawAnswers = [];
let uniqueCards = [];
let currentBets = {};
let timeLeft = 0;
let currentQuestionText = '';
let lastResult = null;
let earlyEnding = false;

// ---------- POMOCNICY ----------
const publicPlayer = p => ({ id: p.id, nick: p.nick, color: p.color, shape: p.shape, money: p.money, connected: p.connected });
const publicList = () => Object.values(players).map(publicPlayer);
const toHosts = (ev, data) => io.to('hosts').emit(ev, data);
const toPlayer = (p, ev, data) => { if (p.socketId) io.to(p.socketId).emit(ev, data); };
const getPlayer = socket => players[socketToPlayer[socket.id]];
const hasAnswered = id => rawAnswers.some(a => a.playerId === id);

function cleanNick(raw) {
    let base = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, cfg.maxNickLength);
    if (!base) return '';
    const taken = new Set(Object.values(players).map(p => p.nick.toLowerCase()));
    let nick = base, n = 2;
    while (taken.has(nick.toLowerCase())) {
        const suffix = ' ' + n++;
        nick = base.slice(0, cfg.maxNickLength - suffix.length) + suffix;
    }
    return nick;
}

function createPlayer(nick) {
    const used = new Set(Object.values(players).map(p => p.color));
    const color = PLAYER_COLORS.find(c => !used.has(c)) || PLAYER_COLORS[nextPlayerNum % PLAYER_COLORS.length];
    const shape = SHAPES[Math.max(0, PLAYER_COLORS.indexOf(color)) % SHAPES.length];
    const p = {
        id: 'p' + nextPlayerNum++, token: crypto.randomBytes(16).toString('hex'),
        socketId: null, nick, color, shape, money: 0, connected: true
    };
    players[p.id] = p;
    tokens[p.token] = p.id;
    return p;
}

// ---------- TIMERY: jeden scheduler, czyszczony przy starcie/zakończeniu gry ----------
const timers = { interval: null, timeouts: new Set() };
function clearTimers() {
    if (timers.interval) { clearInterval(timers.interval); timers.interval = null; }
    timers.timeouts.forEach(clearTimeout);
    timers.timeouts.clear();
}
function later(ms, fn) {
    const t = setTimeout(() => { timers.timeouts.delete(t); fn(); }, ms);
    timers.timeouts.add(t);
}
function startTimer(seconds, callback) {
    if (timers.interval) clearInterval(timers.interval);
    timeLeft = seconds;
    timers.interval = setInterval(() => {
        timeLeft--;
        io.emit('timer_tick', timeLeft);
        if (timeLeft <= 0) {
            clearInterval(timers.interval);
            timers.interval = null;
            callback();
        }
    }, 1000);
}

// ---------- SYNCHRONIZACJA PO ODŚWIEŻENIU ----------
function bettingOptions() {
    return uniqueCards.map(c => ({ val: c.val, display: c.displayVal || c.val, odds: c.odds, bgStyle: c.bgStyle }));
}

function syncHost(socket) {
    socket.emit('update_player_list', publicList());
    socket.emit('state_sync', { phase });
    if (phase === 'FINISHED') {
        return socket.emit('game_finished', publicList().sort((a, b) => b.money - a.money));
    }
    if (phase === 'IDLE') return;
    socket.emit('new_question', { text: currentQuestionText, time: timeLeft, total: cfg.roundTime });
    socket.emit('timer_tick', timeLeft);
    if (phase === 'QUESTION') {
        rawAnswers.forEach(a => socket.emit('player_answered_event', { id: a.playerId, nick: a.nick, color: a.color, shape: a.shape }));
        return;
    }
    socket.emit('display_sorted_answers', uniqueCards);
    Object.keys(currentBets).forEach(pid => {
        if (players[pid]) socket.emit('host_update_bet_live', { playerId: pid, color: players[pid].color, bets: currentBets[pid] });
    });
    if (phase === 'BETTING') socket.emit('start_betting_phase', { time: timeLeft, total: cfg.bettingTime });
    if (phase === 'RESULT' && lastResult) socket.emit('show_round_result', lastResult);
}

function syncPlayer(p) {
    if (!p.socketId) return;
    const e = (ev, d) => io.to(p.socketId).emit(ev, d);
    e('timer_tick', timeLeft);
    if (phase === 'QUESTION') {
        if (hasAnswered(p.id)) e('answer_accepted');
        else e('new_question', { text: currentQuestionText, time: timeLeft, total: cfg.roundTime });
    } else if (phase === 'BETTING') {
        if (hasAnswered(p.id)) {
            e('update_wallet', p.money);
            e('start_betting_phase', {
                options: bettingOptions(), time: timeLeft, total: cfg.bettingTime,
                permChips: cfg.permChips, baseChipValue: cfg.baseChipValue, bets: currentBets[p.id] || []
            });
        } else e('round_eliminated');
    } else if (phase === 'RESULT' && lastResult) {
        e('update_wallet', p.money);
        e('show_round_result', lastResult);
    }
}

// ---------- SOCKETY ----------
io.on('connection', (socket) => {
    socket.on('host_join', () => {
        if (!isLocalAddress(socket.handshake.address)) return socket.emit('host_denied');
        socket.join('hosts');
        socket.data.isHost = true;
        syncHost(socket);
    });

    socket.on('join_game', (data) => {
        if (!data || typeof data !== 'object') data = { nick: data };
        const known = typeof data.token === 'string' && tokens[data.token] ? players[tokens[data.token]] : null;
        let p = known;

        if (p) {
            p.socketId = socket.id;
            p.connected = true;
        } else {
            if (phase === 'FINISHED') return socket.emit('join_error', 'Gra się właśnie zakończyła. Poczekaj na nową.');
            if (Object.keys(players).length >= cfg.maxPlayers) return socket.emit('join_error', 'Gra jest pełna.');
            const nick = cleanNick(data.nick);
            if (!nick) return socket.emit('join_error', 'Wpisz nick.');
            p = createPlayer(nick);
            p.socketId = socket.id;
        }
        socketToPlayer[socket.id] = p.id;
        socket.join('players');
        socket.emit('assigned_identity', { id: p.id, color: p.color, shape: p.shape, token: p.token });
        toHosts('update_player_list', publicList());
        syncPlayer(p);
    });

    socket.on('send_answer', (value) => {
        const p = getPlayer(socket);
        if (phase !== 'QUESTION' || !p || hasAnswered(p.id)) return;
        const val = logic.parseAnswer(value);
        if (val === null) return socket.emit('answer_rejected');
        rawAnswers.push({ playerId: p.id, val, nick: p.nick, color: p.color, shape: p.shape });
        socket.emit('answer_accepted');
        toHosts('player_answered_event', { id: p.id, nick: p.nick, color: p.color, shape: p.shape });
        maybeEndQuestionEarly();
    });

    socket.on('send_bet', (chipsList) => {
        const p = getPlayer(socket);
        if (phase !== 'BETTING' || !p || !hasAnswered(p.id)) return;
        const bets = logic.validateBets(chipsList, {
            money: p.money, cardVals: uniqueCards.map(c => c.val),
            permChips: cfg.permChips, baseValue: cfg.baseChipValue
        });
        if (!bets) return socket.emit('bet_rejected');
        currentBets[p.id] = bets;
        toHosts('host_update_bet_live', { playerId: p.id, color: p.color, bets });
    });

    socket.on('host_start_game', () => {
        if (!socket.data.isHost || phase !== 'IDLE') return;
        if (!Object.values(players).some(p => p.connected)) return socket.emit('host_error', 'Brak podłączonych graczy.');
        clearTimers();
        Object.values(players).forEach(p => { p.money = 0; });
        const deck = logic.shuffleArray([...allQuestions]);
        activeQuestions = deck.slice(0, Math.min(cfg.maxRounds || deck.length, deck.length));
        qIndex = 0;
        toHosts('update_player_list', publicList());
        runPhaseQuestion();
    });

    // Nowa gra po zakończeniu: wszyscy dostają nowe ID (stare tokeny przestają działać).
    socket.on('host_new_game', () => {
        if (!socket.data.isHost || phase !== 'FINISHED') return;
        clearTimers();
        players = {}; tokens = {}; socketToPlayer = {}; nextPlayerNum = 1;
        rawAnswers = []; uniqueCards = []; currentBets = {}; lastResult = null;
        phase = 'IDLE';
        io.emit('lobby_reset');
    });

    socket.on('disconnect', () => {
        const pid = socketToPlayer[socket.id];
        delete socketToPlayer[socket.id];
        const p = players[pid];
        if (!p || p.socketId !== socket.id) return;
        p.connected = false;
        p.socketId = null;
        if (phase === 'IDLE') { delete tokens[p.token]; delete players[p.id]; }
        toHosts('update_player_list', publicList());
        if (phase === 'QUESTION') maybeEndQuestionEarly();
    });
});

// ---------- FAZY GRY ----------
function maybeEndQuestionEarly() {
    const active = Object.values(players).filter(p => p.connected);
    if (phase !== 'QUESTION' || earlyEnding || active.length === 0) return;
    if (!active.every(p => hasAnswered(p.id))) return;
    earlyEnding = true;
    clearTimers();
    timeLeft = 0;
    io.emit('timer_tick', 0);
    later(1000, runPhaseShowAnswers);
}

function runPhaseQuestion() {
    if (qIndex >= activeQuestions.length) return finishGame();
    phase = 'QUESTION';
    rawAnswers = []; uniqueCards = []; currentBets = {}; lastResult = null; earlyEnding = false;
    const q = activeQuestions[qIndex];
    currentQuestionText = q.text;
    io.emit('new_question', { text: q.text, time: cfg.roundTime, total: cfg.roundTime });
    startTimer(cfg.roundTime, runPhaseShowAnswers);
}

function runPhaseShowAnswers() {
    phase = 'SHOW_ANSWERS';
    uniqueCards = logic.buildCards(rawAnswers);
    io.emit('display_sorted_answers', uniqueCards);
    later(4000, runPhaseBetting);
}

function runPhaseBetting() {
    if (uniqueCards.length === 0) return runPhaseResults(); // nikt nie odpowiedział
    phase = 'BETTING';
    const options = bettingOptions();
    Object.values(players).forEach(p => {
        if (hasAnswered(p.id)) {
            toPlayer(p, 'update_wallet', p.money);
            toPlayer(p, 'start_betting_phase', {
                options, time: cfg.bettingTime, permChips: cfg.permChips, baseChipValue: cfg.baseChipValue, bets: []
            });
        } else {
            toPlayer(p, 'round_eliminated');
        }
    });
    toHosts('start_betting_phase', { time: cfg.bettingTime });
    startTimer(cfg.bettingTime, runPhaseResults);
}

function runPhaseResults() {
    phase = 'RESULT';
    const correct = activeQuestions[qIndex].answer;
    const { winnerCardId, payouts } = logic.settleRound({
        cards: uniqueCards, bets: currentBets, correct, writerBonus: cfg.writerBonus
    });
    Object.keys(payouts).forEach(id => { if (players[id]) players[id].money += payouts[id]; });

    lastResult = {
        correct, winningValue: winnerCardId, players: publicList(),
        bets: currentBets, payouts, resultTime: cfg.resultTime, revealDelay: cfg.revealDelay
    };
    // TV dostaje wynik od razu (suspens), telefony chwilę później, żeby nie zdradzały odpowiedzi.
    toHosts('show_round_result', lastResult);
    later(cfg.revealDelay, () => {
        io.to('players').emit('show_round_result', lastResult);
        Object.values(players).forEach(p => toPlayer(p, 'update_wallet', p.money));
    });

    qIndex++;
    let left = cfg.resultTime;
    const step = () => {
        left--;
        if (left <= 3) io.emit('prepare_next_question', left);
        if (left <= 0) return runPhaseQuestion();
        later(1000, step);
    };
    later(1000, step);
}

function finishGame() {
    clearTimers();
    phase = 'FINISHED';
    tokens = {}; // ID graczy resetowane po zakończeniu rozgrywki
    io.emit('game_finished', publicList().sort((a, b) => b.money - a.money));
}

server.listen(cfg.serverPort, '0.0.0.0', () => {
    console.log(`Serwer działa na porcie ${cfg.serverPort}`);
    console.log(`Ekran hosta: http://localhost:${cfg.serverPort}/host.html`);
    lanAddresses().forEach(ip => console.log(`Gracze:       http://${ip}:${cfg.serverPort}`));
    if (!QRCode) console.log('(Kod QR w lobby: npm install, żeby doinstalować paczkę qrcode)');
});
