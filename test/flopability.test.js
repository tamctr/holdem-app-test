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

check('spotStats keeps an unfinished flop on the flopability distribution', () => {
  const hole = [pc('Ah'), pc('Kh')];
  const pre = H.spotStats({ hole, board: [], dead: [] });
  const flop = H.flopability({ hole, board: [], dead: [] });
  assert.equal(pre.kind, 'exact');
  assert.equal(pre.denominator, flop.denominator);
  assert.equal(pre.made.flush, flop.made.flush);
  assert.equal(pre.draws.gutshot, flop.draws.gutshot);
  const partial = H.spotStats({ hole, board: [pc('Qh'), null, null, null, null], dead: [] });
  assert.equal(partial.denominator, C(49, 2));
  assert.equal(partial.kind, 'exact');
});

check('a dealt flop enumerates the turn and river, and the turn changes both columns', () => {
  const hole = [pc('Ah'), pc('Kh')];
  const flop = [pc('Qh'), pc('Jd'), pc('2s')];
  const open = H.spotStats({ hole, board: flop.concat([null, null]), dead: [] });
  assert.equal(open.kind, 'runout');
  assert.equal(open.streetsLeft, 2);
  assert.equal(open.denominator, C(47, 2));
  assert.equal(sumMade(open), open.denominator);
  assert.ok(open.made.straight > 0);
  assert.equal(open.draws.gutshot, 1);
  assert.equal(open.draws.flushDraw, 0);
  assert.equal(open.draws.backdoorFlush, 1);
  const turn = H.spotStats({ hole, board: flop.concat([pc('Th'), null]), dead: [] });
  assert.equal(turn.kind, 'runout');
  assert.equal(turn.streetsLeft, 1);
  assert.equal(turn.denominator, 46);
  assert.equal(sumMade(turn), 46);
  assert.equal(turn.made.flush, 8);
  assert.equal(turn.made.straightFlush, 1);
  assert.equal(turn.made.straight, 37);
  assert.equal(turn.draws.flushDraw, 1);
  assert.equal(turn.draws.flushDrawBoth, 1);
  assert.equal(turn.draws.gutshot, 0);
  assert.equal(turn.draws.backdoorFlush, 0);
  assert.notEqual(turn.made.straight, open.made.straight);
  const done = H.spotStats({ hole, board: flop.concat([pc('Th'), pc('9c')]), dead: [] });
  assert.equal(done.kind, 'realized');
  assert.equal(done.made.straight, 1);
  assert.equal(done.made.noPair, 0);
  assert.equal(done.draws.gutshot, 0);
  assert.equal(done.draws.flushDraw, 0);
  const flopOnly = H.flopability({ hole, board: flop.concat([pc('Th'), pc('9c')]), dead: [] });
  assert.equal(flopOnly.made.noPair, 1);
  assert.notEqual(done.made.straight, flopOnly.made.straight);
});

check('a later street upgrades a set, and a different hand does not reuse those counts', () => {
  const set = H.spotStats({ hole: [pc('9h'), pc('9d')], board: [pc('9c'), pc('Ks'), pc('2d'), pc('3c'), pc('4s')], dead: [] });
  assert.equal(set.made.set, 1);
  const house = H.spotStats({ hole: [pc('9h'), pc('9d')], board: [pc('9c'), pc('Ks'), pc('2d'), pc('2c'), pc('4s')], dead: [] });
  assert.equal(house.made.fullHouse, 1);
  assert.equal(house.made.set, 0);
  const other = H.spotStats({ hole: [pc('Ah'), pc('Kd')], board: [pc('9c'), pc('Ks'), pc('2d'), pc('3c'), pc('4s')], dead: [] });
  assert.equal(other.made.onePair, 1);
  assert.notEqual(other.made.set, set.made.set);
});

check('flop chances sum to 19,600 and match known hands', () => {
  const aa = H.flopChances([pc('As'), pc('Ad')]);
  assert.equal(aa.status, 'ok');
  assert.equal(aa.n, C(50, 3));
  assert.equal(sumMade(aa), aa.n);
  assert.equal(aa.made.set, 2112);
  assert.equal(aa.made.hc, 0);
  const withSetCard = aa.n - C(48, 3);
  assert.ok(Math.abs(withSetCard / aa.n - 0.1176) < 0.001, 'pocket pair sees a set card on about 11.8% of flops');
  const suited = H.flopChances([pc('7h'), pc('6h')]);
  assert.equal(sumMade(suited), suited.n);
  assert.equal(suited.made.fl + suited.made.sf, C(11, 3));
  assert.ok(Math.abs((suited.made.fl + suited.made.sf) / suited.n - 0.0084) < 0.0003, 'suited connector flush about 0.84%');
  assert.ok(suited.draw.oe > 0 && suited.draw.gs > 0 && suited.draw.combo > 0);
  assert.ok(suited.draw.any <= suited.draw.nfd + suited.draw.fd + suited.draw.oe + suited.draw.gs);
  assert.equal(suited.draw.nfd + suited.draw.fd > 0, true);
  const ak = H.flopChances([pc('Ah'), pc('Kh')]);
  assert.equal(ak.draw.fd, 0);
  assert.equal(ak.draw.nfd, C(11, 2) * 39);
});

check('advanced mixes add up, and a dealt straight keeps its flush draw', () => {
  const adv = H.flopAdvanced([pc('9h'), pc('8h')]);
  assert.equal(adv.n, C(50, 3));
  let covered = adv.fplus;
  Object.keys(adv.g).forEach(k => {
    const G = adv.g[k];
    assert.equal(G.fs.n + G.f.n + G.s.n + G.x.n, G.n, k);
    covered += G.n;
  });
  assert.equal(covered, adv.n);
  const now = H.boardDraws([pc('Ah'), pc('Kh')], [pc('Qh'), pc('Jd'), pc('2s'), pc('Th')]);
  assert.equal(now.nfd, 1);
  assert.equal(now.gs, 0);
  assert.equal(now.oe, 0);
  assert.equal(now.any, 1);
});

check('nut flush draw on the flop is 9 outs and 34.97% by the river', () => {
  const o = H.streetOutlook([pc('Ah'), pc('Kh')], [pc('Qh'), pc('7h'), pc('2c')]);
  assert.equal(o.status, 'ok');
  assert.equal(o.street, 'flop');
  assert.equal(o.n, C(47, 2));
  const row = o.rows.find(r => r.id === 'fd');
  assert.ok(row);
  assert.equal(row.label, 'Nut flush draw');
  assert.equal(row.outs, 9);
  assert.equal(row.hit, 378);
  assert.ok(Math.abs(row.hit / row.n - 0.3497) < 0.0001);
  assert.ok(!o.rows.some(r => r.id === 'oesd' || r.id === 'gs'));
  const sum = o.final.reduce((s, r) => s + r.count, 0);
  assert.equal(sum, o.n);
});

check('open-ended straight draw is 8 outs and 31.45% by the river', () => {
  const o = H.streetOutlook([pc('8c'), pc('9c')], [pc('7d'), pc('6s'), pc('2h')]);
  const row = o.rows.find(r => r.id === 'oesd');
  assert.equal(row.outs, 8);
  assert.equal(row.hit, 340);
  assert.ok(Math.abs(row.hit / row.n - 0.3145) < 0.0001);
  assert.equal(row.label, 'Open-ended straight draw');
});

check('a backdoor flush draw is about 4.16%', () => {
  const o = H.streetOutlook([pc('Ah'), pc('Kh')], [pc('Qh'), pc('7c'), pc('2d')]);
  const row = o.rows.find(r => r.id === 'bdf');
  assert.ok(row);
  assert.equal(row.runner, true);
  assert.equal(row.outs, null);
  assert.equal(row.hit, 45);
  assert.equal(row.n, C(47, 2));
  assert.ok(Math.abs(row.hit / row.n - 0.0416) < 0.0001);
  assert.ok(!o.rows.some(r => r.id === 'fd'));
});

check('a set improves to a full house or better about 33.4% of the time', () => {
  const o = H.streetOutlook([pc('9h'), pc('9d')], [pc('9c'), pc('Ks'), pc('2d')]);
  const row = o.rows.find(r => r.id === 'boat');
  assert.equal(row.outs, 7);
  assert.equal(row.hit, 361);
  assert.ok(Math.abs(row.hit / row.n - 0.334) < 0.001);
  const made = o.rows.find(r => r.id === 'made');
  assert.equal(made.label, 'Set');
  assert.equal(made.sub, 'pocket pair + board card');
});

check('the turn uses one-card odds and the river is the made hand only', () => {
  const turn = H.streetOutlook([pc('Ah'), pc('Kh')], [pc('Qh'), pc('7h'), pc('2c'), pc('3d')]);
  assert.equal(turn.street, 'turn');
  assert.equal(turn.n, 46);
  const fd = turn.rows.find(r => r.id === 'fd');
  assert.equal(fd.outs, 9);
  assert.equal(fd.hit, 9);
  assert.ok(!turn.rows.some(r => r.id === 'bdf' || r.id === 'bds' || r.id === 'rrfh' || r.id === 'rrq'));
  const river = H.streetOutlook([pc('Ah'), pc('Kh')], [pc('Qh'), pc('7h'), pc('2c'), pc('3d'), pc('4s')]);
  assert.equal(river.street, 'river');
  assert.equal(river.rows.length, 1);
  assert.equal(river.rows[0].id, 'made');
  assert.equal(river.rows[0].label, 'High card');
  assert.equal(river.final.length, 0);
});

console.log('PASSED', passed);
