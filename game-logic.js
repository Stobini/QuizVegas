// Czysta logika gry: bez socketów i bez stanu, dzięki temu da się ją testować.
const SMALLER_THAN_LOWEST_ID = Number.MIN_SAFE_INTEGER; // nie koliduje z żadną dozwoloną odpowiedzią (±1e12)
const MAX_ANSWER = 1e12;

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

const questionKey = q => q.text.trim().toLowerCase();

// Losuje `count` pytań, najpierw spośród jeszcze nieużytych (zbiór `used`).
// Gdy nieużytych jest za mało, bierze wszystkie pozostałe, zeruje historię
// i dolosowuje resztę z całej bazy (bez powtórzeń w obrębie jednej gry).
function pickQuestions(all, used, count) {
    const limit = Math.min(count || all.length, all.length);
    const fresh = shuffleArray(all.filter(q => !used.has(questionKey(q))));
    if (fresh.length >= limit) return fresh.slice(0, limit);
    used.clear();
    const taken = new Set(fresh.map(questionKey));
    const rest = shuffleArray(all.filter(q => !taken.has(questionKey(q))));
    return fresh.concat(rest.slice(0, limit - fresh.length));
}

// Odrzuca wadliwe wpisy i duplikaty tekstu pytania.
function cleanQuestions(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.filter(q => {
        if (!q || typeof q.text !== 'string' || !Number.isSafeInteger(q.answer)) return false;
        const key = q.text.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Zwraca liczbę całkowitą albo null (puste pole, ułamek, tekst, zbyt duża liczba).
function parseAnswer(value) {
    const s = String(value === undefined || value === null ? '' : value).trim();
    if (!/^-?\d{1,12}$/.test(s)) return null;
    const n = Number(s);
    return Math.abs(n) <= MAX_ANSWER ? n : null;
}

function getCardBackground(authors) {
    if (!authors || authors.length === 0) return '#333';
    if (authors.length === 1) return authors[0].color;
    const step = 100 / authors.length;
    let g = 'linear-gradient(90deg';
    authors.forEach((a, i) => { g += `, ${a.color} ${i * step}%, ${a.color} ${(i + 1) * step}%`; });
    return g + ')';
}

// rawAnswers: [{playerId, val, nick, color}]
function buildCards(rawAnswers) {
    const groups = {};
    rawAnswers.forEach(ans => {
        if (!groups[ans.val]) groups[ans.val] = { val: ans.val, authors: [] };
        groups[ans.val].authors.push({ nick: ans.nick, color: ans.color, shape: ans.shape, pid: ans.playerId });
    });
    const cards = Object.keys(groups).map(Number).sort((a, b) => a - b).map(v => groups[v]);

    if (cards.length > 0) {
        cards.unshift({ val: SMALLER_THAN_LOWEST_ID, displayVal: `< ${cards[0].val}`, authors: [] });
    }
    const medianIndex = Math.floor((cards.length - 1) / 2);
    return cards.map((card, index) => ({
        ...card,
        odds: 2 + Math.abs(index - medianIndex),
        bgStyle: getCardBackground(card.authors)
    }));
}

// Wygrywa karta najbliższa prawdy, ale nieprzekraczająca jej. Brak kart = null.
function findWinner(cards, correct) {
    const numeric = cards.filter(c => c.val !== SMALLER_THAN_LOWEST_ID);
    if (numeric.length === 0) return null;
    if (correct < numeric[0].val) return SMALLER_THAN_LOWEST_ID;
    let winner = null, bestDiff = Infinity;
    numeric.forEach(c => {
        if (c.val <= correct && correct - c.val < bestDiff) { bestDiff = correct - c.val; winner = c.val; }
    });
    return winner;
}

// Sprawdza zakłady od klienta i zwraca ich znormalizowaną wersję albo null.
// Serwer nie ufa wartościom z klienta (kwoty ujemne, za dużo żetonów, nieistniejące karty).
function validateBets(list, { money, cardVals, permChips, baseValue }) {
    if (!Array.isArray(list) || list.length > 60) return null;
    const vals = new Set(cardVals);
    const permOn = {};
    let perm = 0, cash = 0;
    const out = [];
    for (const c of list) {
        if (!c || typeof c !== 'object') return null;
        if (!Number.isSafeInteger(c.targetVal) || !vals.has(c.targetVal)) return null;
        const id = typeof c.id === 'string' ? c.id.slice(0, 40) : '';
        if (c.type === 'PERM') {
            if (++perm > permChips) return null;
            permOn[c.targetVal] = true;
            out.push({ id, type: 'PERM', value: baseValue, display: String(baseValue), targetVal: c.targetVal });
        } else if (c.type === 'CASH') {
            if (!Number.isSafeInteger(c.value) || c.value <= 0) return null;
            cash += c.value;
            if (cash > money) return null;
            out.push({ id, type: 'CASH', value: c.value, display: String(c.value), targetVal: c.targetVal });
        } else {
            return null;
        }
    }
    // gotówkę można postawić tylko na karcie, na której leży żeton stały
    if (out.some(c => c.type === 'CASH' && !permOn[c.targetVal])) return null;
    return out;
}

// Zwraca zwycięską kartę i zmianę salda każdego gracza (bonus autora + wygrane - przegrana gotówka).
function settleRound({ cards, bets, correct, writerBonus }) {
    const winnerCardId = findWinner(cards, correct);
    const payouts = {};
    const add = (id, n) => { payouts[id] = (payouts[id] || 0) + n; };
    const win = winnerCardId === null ? null : cards.find(c => c.val === winnerCardId);

    if (win && winnerCardId !== SMALLER_THAN_LOWEST_ID) {
        win.authors.forEach(a => add(a.pid, writerBonus));
    }
    Object.keys(bets).forEach(pid => {
        add(pid, 0);
        bets[pid].forEach(chip => {
            if (win && chip.targetVal === winnerCardId) add(pid, chip.value * win.odds);
            else if (chip.type === 'CASH') add(pid, -chip.value);
        });
    });
    return { winnerCardId, payouts };
}

module.exports = {
    SMALLER_THAN_LOWEST_ID, shuffleArray, cleanQuestions, parseAnswer, questionKey, pickQuestions,
    buildCards, findWinner, validateBets, settleRound
};
