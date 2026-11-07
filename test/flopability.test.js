'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script id="core-src">([\s\S]*?)<\/script>/);
assert.ok(m, 'core script missing');
const context = { module: { exports: {} }, exports: {}, console };
context.self = context;
context.global = context;
vm.runInNewContext(m[1], context, { filename: 'core.js' });
const H = context.module.exports;
assert.equal(typeof H.flopability, 'function');
assert.equal(typeof H.flopTexture, 'function');

const pc = H.parseCard;
const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); };
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

function sumMade(res) {
  return Object.values(res.made).reduce((s, n) => s + n, 0);
}

check('pocket pair closed forms, full deck', () => {
  const res = H.flopability({ hole: [pc('As'), pc('Ad')], board: [null, null, null, null, null], dead: [] });
  assert.equal(res.status, 'ok');
  assert.equal(res.kind, 'exact');
  assert.equal(res.denominator, C(50, 3));
  assert.equal(sumMade(res), res.denominator);
  assert.equal(res.made.quads, 48);
  // 144 = one ace plus a side pair; 48 = pocket pair over three-of-a-kind on the board (also a full house).
  assert.equal(res.made.fullHouse, 192);
  assert.equal(res.made.set, 2112);
  assert.equal(res.made.boardTrips, 0);
  assert.equal(res.made.twoPair, 3168);
  assert.equal(res.made.onePair, 14080);
  assert.equal(res.made.trips, 0);
  assert.equal(res.made.noPair, 0);
  assert.equal(res.made.flush, 0);
  assert.equal(res.made.straight, 0);
  assert.equal(res.made.straightFlush, 0);
  assert.equal(res.made.boardPair, 0);
  // One-card flush draw: the board is three hearts (Ah in hand) or three diamonds (Ad in hand).
  assert.equal(res.draws.flushDraw, 2 * C(12, 3));
  assert.equal(res.draws.flushDrawOne, 2 * C(12, 3));
  assert.equal(res.draws.flushDrawBoth, 0);
  assert.equal(res.draws.backdoorFlush, 2 * C(12, 2) * 38);
  const better = res.made.set + res.made.fullHouse + res.made.quads;
  assert.equal(better, 2352);
});

check('dead ace blocks quads and changes the set count', () => {
  const res = H.flopability({ hole: [pc('Ah'), pc('Ad')], board: [], dead: [pc('As')] });
  assert.equal(res.denominator, C(49, 3));
  assert.equal(res.made.quads, 0);
  assert.equal(res.made.set, C(12, 2) * 16);
  assert.equal(sumMade(res), res.denominator);
  const full = H.flopability({ hole: [pc('Ah'), pc('Ad')], board: [], dead: [] });
  assert.notEqual(res.made.set, full.made.set);
});

check('suited broadway flush, flush draw, backdoor, one straight flush', () => {
  const res = H.flopability({ hole: [pc('Ah'), pc('Kh')], board: [null, null, null, null, null], dead: [] });
  assert.equal(res.made.flush + res.made.straightFlush, C(11, 3));
  assert.equal(res.made.straightFlush, 1);
  assert.equal(res.draws.flushDraw, C(11, 2) * 39);
  assert.equal(res.draws.flushDrawBoth, C(11, 2) * 39);
  assert.equal(res.draws.flushDrawOne, 0);
  assert.equal(res.draws.backdoorFlush, C(11, 1) * C(39, 2));
  assert.equal(sumMade(res), res.denominator);
});

check('dead heart blocks suited flush outs', () => {
  const res = H.flopability({ hole: [pc('Ah'), pc('Kh')], board: [], dead: [pc('Qh')] });
  assert.equal(res.denominator, C(49, 3));
  assert.equal(res.made.flush + res.made.straightFlush, C(10, 3));
  assert.equal(res.made.straightFlush, 0);
});

check('offsuit AK flush draws are one-card, and board-only monotones are not draws', () => {
  const hole = [pc('Ah'), pc('Kd')];
  const res = H.flopability({ hole, board: [], dead: [] });
  assert.equal(res.made.flush + res.made.straightFlush, 0);
  assert.equal(res.made.quads, 2);
  assert.equal(res.made.fullHouse, 18);
  assert.equal(res.draws.flushDraw, 2 * C(12, 3));
  assert.equal(res.draws.flushDrawOne, 2 * C(12, 3));
  assert.equal(res.draws.flushDrawBoth, 0);
  assert.equal(res.draws.backdoorFlush, 2 * C(12, 2) * 38);
  let boardOnly = 0, heroDraw = 0;
  const deck = [];
  const used = new Set(hole);
  for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) for (let k = j + 1; k < deck.length; k++) {
    const cards = hole.concat(deck[i], deck[j], deck[k]);
    const sc = [0, 0, 0, 0], hs = [0, 0, 0, 0];
    cards.forEach(c => sc[c & 3]++);
    hs[hole[0] & 3]++; hs[hole[1] & 3]++;
    let draw = false, flush = false;
    for (let s = 0; s < 4; s++) {
      if (sc[s] >= 5) flush = true;
      if (sc[s] === 4 && hs[s] > 0) draw = true;
      if (sc[s] === 3 && hs[s] === 0) boardOnly++;
    }
    if (draw && !flush) heroDraw++;
  }
  assert.ok(boardOnly > 0);
  assert.equal(heroDraw, res.draws.flushDraw);
  assert.notEqual(boardOnly, res.draws.flushDraw);
});

check('partial flop conditions on the known card', () => {
  const res = H.flopability({ hole: [pc('Ah'), pc('Kh')], board: [pc('Qh'), null, null, null, null], dead: [] });
  assert.equal(res.missing, 2);
  assert.equal(res.denominator, C(49, 2));
  assert.equal(res.deckSize, 49);
  assert.equal(res.made.flush + res.made.straightFlush, C(10, 2));
  assert.equal(res.made.straightFlush, 1);
  assert.equal(sumMade(res), res.denominator);
});

check('made hands match the showdown evaluator, with set/trips/board split', () => {
  const hands = [['As', 'Ad'], ['Ah', 'Kh'], ['Ah', 'Kd'], ['7h', '6h'], ['Jh', '7c']];
  hands.forEach(pair => {
    const hole = pair.map(pc);
    const used = new Set(hole);
    const deck = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) for (let k = j + 1; k < deck.length; k++) {
      const flop = [deck[i], deck[j], deck[k]];
      const tex = H.flopTexture(hole, flop);
      const cards = hole.concat(flop);
      const cat = H.handCategory(H.evalHand(cards, 5));
      const map = { 8: 'straightFlush', 7: 'quads', 6: 'fullHouse', 5: 'flush', 4: 'straight', 2: 'twoPair', 0: 'noPair' };
      if (cat === 3 || cat === 1) {
        const rc = {};
        cards.forEach(c => { const r = c >> 2; rc[r] = (rc[r] || 0) + 1; });
        const rank = +Object.keys(rc).find(r => rc[r] === (cat === 3 ? 3 : 2));
        const onBoard = flop.filter(c => (c >> 2) === rank).length;
        const holeMatch = (hole[0] >> 2) === rank || (hole[1] >> 2) === rank;
        const expect = cat === 3
          ? (onBoard === 3 ? 'boardTrips' : ((hole[0] >> 2) === (hole[1] >> 2) && (hole[0] >> 2) === rank ? 'set' : 'trips'))
          : (holeMatch ? 'onePair' : 'boardPair');
        assert.equal(tex.made, expect, H.cardStr(hole[0]) + H.cardStr(hole[1]) + ' on ' + flop.map(H.cardStr).join(''));
      } else {
        assert.equal(tex.made, map[cat], H.cardStr(hole[0]) + H.cardStr(hole[1]) + ' cat ' + cat + ' on ' + flop.map(H.cardStr).join(''));
      }
      assert.ok((tex.oesd ? 1 : 0) + (tex.doubleGut ? 1 : 0) + (tex.gutshot ? 1 : 0) <= 1);
      if (tex.made === 'straight' || tex.made === 'straightFlush') assert.equal(tex.oesd || tex.doubleGut || tex.gutshot, false);
      if (tex.made === 'flush' || tex.made === 'straightFlush') assert.equal(tex.flushDraw, false);
      if (tex.made === 'set') assert.equal(tex.oesd || tex.gutshot || tex.doubleGut || tex.flushDraw, false);
    }
  });
});

check('realized labels: set, trips, board pair, board trips, oesd, double gutshot, gutshot', () => {
  const one = (hole, flop, expect) => {
    const res = H.flopability({ hole: hole.map(pc), board: flop.map(pc).concat([null, null]).slice(0, 5), dead: [] });
    assert.equal(res.kind, 'realized');
    assert.equal(res.denominator, 1);
    const tex = H.flopTexture(hole.map(pc), flop.map(pc));
    Object.keys(expect).forEach(k => {
      if (k === 'made') assert.equal(tex.made, expect[k], hole.join('') + ' ' + flop.join('') + ' made');
      else assert.equal(!!tex[k], !!expect[k], hole.join('') + ' ' + flop.join('') + ' ' + k);
    });
    assert.equal(res.made[expect.made], 1);
  };
  one(['9h', '9d'], ['9c', 'Ks', '2d'], { made: 'set', oesd: false, gutshot: false, doubleGut: false });
  one(['Ah', 'Kd'], ['Ac', 'Ad', '2s'], { made: 'trips' });
  one(['Ah', '7d'], ['2c', '2d', '9s'], { made: 'boardPair', flushDraw: false });
  one(['Ah', 'Kd'], ['7c', '7d', '7s'], { made: 'boardTrips' });
  one(['7h', '8d'], ['6c', '5s', 'Kh'], { made: 'noPair', oesd: true, doubleGut: false, gutshot: false });
  one(['Jh', '7c'], ['9d', '8s', '5h'], { made: 'noPair', doubleGut: true, oesd: false, gutshot: false });
  one(['7h', '8d'], ['5c', '9d', 'Ks'], { made: 'noPair', gutshot: true, oesd: false, doubleGut: false });
  one(['Ah', 'Kh'], ['Qc', 'Jd', '2s'], { made: 'noPair', gutshot: true, oesd: false, doubleGut: false });
  one(['Ah', 'Kd'], ['Kh', 'Qh', '2h'], { made: 'onePair', flushDraw: true, flushDrawOne: true, oesd: false });
  one(['8h', '8d'], ['6c', '7d', '9s'], { made: 'onePair', oesd: true, flushDraw: false });
});

check('need a specific hand, and conflicts are not a fake result', () => {
  assert.equal(H.flopability({ hole: [pc('As')], board: [], dead: [] }).status, 'need-hand');
  assert.equal(H.flopability({ hole: [], board: [], dead: [] }).status, 'need-hand');
  const clash = H.flopability({ hole: [pc('As'), pc('Ks')], board: [pc('As'), null, null, null, null], dead: [] });
  assert.equal(clash.status, 'conflict');
  assert.equal(clash.denominator, undefined);
});

check('turn and river do not change a dealt flop, but block an unfinished one', () => {
  const dealt = H.flopability({ hole: [pc('Ah'), pc('Kh')], board: [pc('2c'), pc('3d'), pc('4h'), pc('5s'), pc('9c')], dead: [] });
  assert.equal(dealt.kind, 'realized');
  assert.equal(dealt.turnRiverKnown, true);
  assert.equal(dealt.made.noPair, 1);
  const open = H.flopability({ hole: [pc('Ah'), pc('Kh')], board: [null, null, null, pc('2c'), null], dead: [] });
  const plain = H.flopability({ hole: [pc('Ah'), pc('Kh')], board: [], dead: [] });
  assert.equal(open.denominator, C(49, 3));
  assert.notEqual(open.denominator, plain.denominator);
  assert.equal(open.turnRiverKnown, true);
});

check('equity engine still resolves a finished board', () => {
  const r = H.runEquity({
    players: [[[pc('As'), pc('Ad')]], [[pc('Kc'), pc('Kd')]]],
    board: [pc('2c'), pc('3d'), pc('4h'), pc('5s'), pc('9c')],
    dead: [], mode: 'exact', trials: 10
  });
  assert.equal(r.players[0].equity, 1);
  assert.equal(r.players[1].equity, 0);
  assert.equal(r.exact, true);
});

console.log('PASSED', passed);
