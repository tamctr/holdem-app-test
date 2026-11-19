'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadCore } = require('../solver/loadcore');
const math = require('../solver/math');
const kuhn = require('../solver/kuhn');
const spots = require('../solver/spots');
const equity = require('../solver/equity');
const { solveHu } = require('../solver/pushfold');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

const H = loadCore();

check('pot odds, MDF, alpha, bluff share', () => {
  // Call 1 into a pot that is already 2 (villain bet 1 into a pot of 1).
  assert.ok(Math.abs(math.requiredEquity(1, 2) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(math.mdf(1, 1) - 1 / 2) < 1e-12);
  assert.ok(Math.abs(math.alpha(1, 1) - 1 / 2) < 1e-12);
  assert.ok(Math.abs(math.bluffShare(1, 1) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(math.valueShare(1, 1) - 2 / 3) < 1e-12);
  assert.ok(Math.abs(math.mdf(1, 1) + math.alpha(1, 1) - 1) < 1e-12);
  // Heads-up big blind versus a 10bb jam: call 9 into a pot of 11, equity (10-1)/(20).
  assert.ok(Math.abs(math.huBbCallEquity(10) - 0.45) < 1e-12);
  assert.ok(Math.abs(math.requiredEquity(9, 11) - 0.45) < 1e-12);
});

check('minimum all-in calling range uses removal', () => {
  const n = H.CLASSES.length;
  const eq = new Float32Array(n * n);
  const live = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    eq[i * n + j] = i === 0 ? 0.9 : 0.2;
    live[i * n + j] = i === j ? 0 : 1;
  }
  const weights = new Array(n).fill(0);
  weights[1] = 12;
  const out = math.minAllInCallingRange(H.CLASSES, weights, eq, { live: live, required: 0.5 });
  assert.ok(out.hands[0].call);
  assert.ok(!out.hands[2].call);
  assert.equal(out.required, 0.5);
});

check('Kuhn poker reaches the known value', () => {
  const r = kuhn.solveKuhn(20000);
  assert.ok(Math.abs(r.value - kuhn.VALUE) < 0.004, 'value ' + r.value);
  assert.ok(r.exploitability < 0.02, 'exploitability ' + r.exploitability);
  const by = (rows, card) => rows.find(x => x.card === card);
  assert.ok(by(r.strategy.p1, 'Q').check > 0.95);
  assert.ok(by(r.strategy.p1, 'J').bet < 0.45);
  assert.ok(by(r.strategy.p2faceBet, 'K').call > 0.95);
  assert.ok(by(r.strategy.p2faceBet, 'J').fold > 0.95);
  assert.ok(by(r.strategy.p1faceBet, 'K').call > 0.95);
  assert.ok(by(r.strategy.p1faceBet, 'J').fold > 0.95);
});

check('class-pair equity is close to an exact combo', () => {
  const { eq } = equity.loadEquity();
  const ix = {};
  H.CLASSES.forEach((k, i) => { ix[k] = i; });
  // As Ah versus Ks Kh. Pair versus pair does not depend on the suits.
  const exact = equity.exactComboEquity(H, H.parseCard('As'), H.parseCard('Ah'), H.parseCard('Ks'), H.parseCard('Kh'));
  const got = eq[ix.AA * 169 + ix.KK];
  assert.ok(Math.abs(got - exact.equity) < 0.02, 'matrix ' + got + ' exact ' + exact.equity);
  assert.ok(exact.equity > 0.80 && exact.equity < 0.84);
  assert.ok(eq[ix.AA * 169 + ix['72o']] > 0.84);
  assert.ok(eq[ix.AA * 169 + ix.AKs] > eq[ix.AKs * 169 + ix.AA]);
});

check('heads-up push/fold is an equilibrium and stacks tighten', () => {
  const { eq, live } = equity.loadEquity();
  const counts = H.CLASSES.map(k => H.classCount(k));
  const aa = H.CLASSES.indexOf('AA');
  const trash = H.CLASSES.indexOf('72o');
  const a = solveHu(eq, live, counts, 8, 300);
  const b = solveHu(eq, live, counts, 10, 300);
  const c = solveHu(eq, live, counts, 12, 300);
  for (const r of [a, b, c]) {
    assert.ok(r.exploitability < 0.03, 'ex ' + r.exploitability);
    assert.ok(r.sbJam[aa] > 0.999);
    assert.ok(r.bbCall[aa] > 0.999);
    assert.ok(r.bbCallPct < r.sbJamPct);
    assert.ok(r.sbJam[trash] < 0.5);
  }
  assert.ok(a.sbJamPct > b.sbJamPct && b.sbJamPct > c.sbJamPct, [a.sbJamPct, b.sbJamPct, c.sbJamPct].join(','));
});

check('spot import: JSON, CSV, and range block', () => {
  const json = spots.parseSpotImport(JSON.stringify({
    format: 'holdem-lab.spots', version: 1,
    spots: [{ id: 'cash|6|100|rfi:BTN', hands: { AA: { raise: 1 }, AKs: { raise: 0.5 } } }]
  }), H.CLASSES);
  assert.equal(json.type, 'spots');
  assert.equal(json.spots[0].hands.AA.raise, 1);
  assert.equal(json.spots[0].hands.AKs.fold, 0.5);
  assert.equal(json.spots[0].hands['72o'].fold, 1);
  assert.equal(json.spots[0].source, 'imported');

  const csv = spots.parseSpotImport([
    '# id: cash|6|100|vs:BB:BTN',
    'hand,fold,call,3bet,allin',
    'AA,0,0,20,80',
    '72o,1,0,0,0'
  ].join('\n'), H.CLASSES);
  assert.equal(csv.spots[0].hands.AA.jam, 0.8);
  assert.equal(csv.spots[0].hands.AA['3bet'], 0.2);
  assert.ok(Math.abs(Object.keys(csv.spots[0].hands.AA).reduce((s, a) => a === 'ev' ? s : s + csv.spots[0].hands.AA[a], 0) - 1) < 1e-6);

  const block = spots.parseSpotImport([
    '# id: cash|6|100|rfi:CO',
    '# action: raise',
    'AA:1, AKs:0.25, 76s'
  ].join('\n'), H.CLASSES);
  assert.equal(block.spots[0].hands.AA.raise, 1);
  assert.equal(block.spots[0].hands.AKs.raise, 0.25);
  assert.equal(block.spots[0].hands['76s'].raise, 1);
  assert.equal(block.spots[0].hands.KK.fold, 1);

  const over = spots.parseSpotImport(JSON.stringify({
    format: 'holdem-lab.spots', version: 1,
    spots: [{ id: 'cash|6|100|rfi:UTG', hands: { AA: { raise: 0.8, fold: 0.8 } } }]
  }), H.CLASSES);
  const cell = over.spots[0].hands.AA;
  const sum = cell.raise + (cell.fold || 0);
  assert.ok(Math.abs(sum - 1) < 0.02, 'normalised ' + sum);

  assert.throws(() => spots.parseSpotImport('# action: raise\nAA:1\n', H.CLASSES), /id:/);
  assert.throws(() => spots.parseSpotImport('{"format":"holdem-lab.spots","version":2,"spots":[]}', H.CLASSES), /version/);
});

check('shipped cash database is ordered and not a copy of a published chart', () => {
  const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cash-spots.json'), 'utf8'));
  spots.validateDatabase(db, H.CLASSES);
  assert.equal(db.format, 'holdem-lab.spots');
  assert.equal(db.version, 1);
  assert.ok(db.model && db.model.id === 'preflop-cfr-v1');
  assert.ok(db.metrics && db.metrics.iterations >= 500);
  function tot(id, action) {
    const s = db.spots.find(x => x.id === id);
    assert.ok(s, id);
    return s.totals[action] || 0;
  }
  const utg = tot('cash|6|100|rfi:UTG', 'raise');
  const hj = tot('cash|6|100|rfi:HJ', 'raise');
  const co = tot('cash|6|100|rfi:CO', 'raise');
  const btn = tot('cash|6|100|rfi:BTN', 'raise');
  const sb = tot('cash|6|100|rfi:SB', 'raise');
  assert.ok(utg < hj && hj < co && co < btn, [utg, hj, co, btn].join(' < '));
  assert.ok(sb > co, 'SB ' + sb + ' CO ' + co);
  assert.ok(utg > 0.08 && utg < 0.25, 'UTG ' + utg);
  assert.ok(btn > 0.25 && btn < 0.55, 'BTN ' + btn);
  for (const seat of ['UTG', 'HJ', 'CO', 'BTN', 'SB']) {
    const s = db.spots.find(x => x.id === 'cash|6|100|rfi:' + seat);
    assert.ok((s.hands.AA.raise || 0) >= 0.98, seat + ' AA');
    assert.ok((s.hands['72o'].raise || 0) < 0.05, seat + ' 72o ' + s.hands['72o'].raise);
    assert.ok((s.hands.KK.raise || 0) >= 0.95, seat + ' KK');
  }
  const bb = db.spots.find(x => x.id === 'cash|6|100|vs:BB:BTN');
  assert.ok(bb.hands.AA['3bet'] > 0.9);
  assert.ok((bb.hands['72o'].fold || 0) > 0.7);
  assert.equal(bb.sizes['3bet'], 10);
  const vj = db.spots.find(x => x.id === 'cash|6|100|vj:BTN:BB');
  assert.ok(vj.hands.AA.call > 0.95);
  assert.ok((vj.hands['72o'].call || 0) < 0.05);
});

console.log(passed + ' passed');
