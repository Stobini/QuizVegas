const test = require('node:test');
const assert = require('node:assert');
const L = require('../game-logic');

const answers = [
  { playerId: 'p1', val: 10, nick: 'A', color: '#f00' },
  { playerId: 'p2', val: 50, nick: 'B', color: '#0f0' },
  { playerId: 'p3', val: 90, nick: 'C', color: '#00f' },
];
const cards = L.buildCards(answers);

test('karta "mniej niż najniższa" wygrywa, gdy prawda jest poniżej wszystkich', () => {
  assert.strictEqual(L.findWinner(cards, 5), L.SMALLER_THAN_LOWEST_ID);
});
test('wygrywa najbliższa odpowiedź nieprzekraczająca prawdy', () => {
  assert.strictEqual(L.findWinner(cards, 80), 50);
  assert.strictEqual(L.findWinner(cards, 500), 90);
});
test('odrzuca ujemną gotówkę, nadmiar żetonów i gotówkę bez żetonu stałego', () => {
  const o = { money: 500, cardVals: [10, 50], permChips: 2, baseValue: 100 };
  assert.strictEqual(L.validateBets([{ type: 'PERM', targetVal: 10 }, { type: 'CASH', value: -5000, targetVal: 10 }], o), null);
  assert.strictEqual(L.validateBets([{ type: 'PERM', targetVal: 10 }, { type: 'PERM', targetVal: 10 }, { type: 'PERM', targetVal: 50 }], o), null);
  assert.strictEqual(L.validateBets([{ type: 'CASH', value: 100, targetVal: 10 }], o), null);
  assert.strictEqual(L.validateBets([{ type: 'PERM', targetVal: 10 }, { type: 'CASH', value: 600, targetVal: 10 }], o), null);
  assert.ok(L.validateBets([{ type: 'PERM', targetVal: 10 }, { type: 'CASH', value: 300, targetVal: 10 }], o));
});
test('rozliczenie: bonus autora, wygrana z mnożnikiem, utrata gotówki', () => {
  const winner = cards.find(c => c.val === 50);
  const bets = {
    p1: [{ type: 'PERM', value: 100, targetVal: 50 }, { type: 'CASH', value: 200, targetVal: 50 }],
    p3: [{ type: 'PERM', value: 100, targetVal: 90 }, { type: 'CASH', value: 400, targetVal: 90 }],
  };
  const r = L.settleRound({ cards, bets, correct: 60, writerBonus: 300 });
  assert.strictEqual(r.winnerCardId, 50);
  assert.strictEqual(r.payouts.p2, 300);                      // autor zwycięskiej karty
  assert.strictEqual(r.payouts.p1, 300 * winner.odds);        // 100 + 200 razy mnożnik
  assert.strictEqual(r.payouts.p3, -400);                     // PERM nie przepada, gotówka tak
});
test('parseAnswer przyjmuje tylko liczby całkowite', () => {
  assert.strictEqual(L.parseAnswer('1912'), 1912);
  ['', 'abc', '3.5', '1e5', '9999999999999'].forEach(v => assert.strictEqual(L.parseAnswer(v), null));
});

test('pickQuestions: kolejne gry nie powtarzają pytań, dopóki są nieużyte', () => {
  const all = Array.from({ length: 20 }, (_, i) => ({ text: 'Q' + i, answer: i }));
  const used = new Set();
  const seen = new Set();
  for (let g = 0; g < 2; g++) {
    const picked = L.pickQuestions(all, used, 10);
    assert.strictEqual(picked.length, 10);
    assert.strictEqual(new Set(picked.map(L.questionKey)).size, 10);
    picked.forEach(q => { assert.ok(!seen.has(q.text)); seen.add(q.text); used.add(L.questionKey(q)); });
  }
  assert.strictEqual(seen.size, 20);
});
test('pickQuestions: gdy nieużytych jest za mało, dolosowuje i zeruje historię', () => {
  const all = Array.from({ length: 12 }, (_, i) => ({ text: 'Q' + i, answer: i }));
  const used = new Set(all.slice(0, 8).map(L.questionKey)); // zostały 4 nieużyte
  const picked = L.pickQuestions(all, used, 10);
  assert.strictEqual(picked.length, 10);
  assert.strictEqual(new Set(picked.map(L.questionKey)).size, 10);
  ['Q8', 'Q9', 'Q10', 'Q11'].forEach(t => assert.ok(picked.some(q => q.text === t)));
  assert.strictEqual(used.size, 0);
});
