'use strict';
const fs = require('fs');
const assert = require('assert');
const { loadCore } = require('../solver/loadcore');
const spots = require('../solver/spots');
const gtow = require('../tools/parse-gtow-rfi');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

const H = loadCore();
const db = gtow.buildDatabase(H.CLASSES);
const shipped = JSON.parse(fs.readFileSync(gtow.JSON_PATH, 'utf8'));

check('parser output matches the shipped reference file', () => {
  assert.equal(shipped.format, 'holdem-lab.spots');
  assert.equal(shipped.version, 1);
  assert.equal(shipped.model.label, 'GTO Wizard reference (NL50, General)');
  assert.equal(shipped.spots.length, 15);
  assert.deepEqual(shipped.spots.map(s => s.id), db.spots.map(s => s.id));
  shipped.spots.forEach((spot, i) => {
    assert.deepEqual(spot.hands, db.spots[i].hands, spot.id);
    assert.deepEqual(spot.headerPct, db.spots[i].headerPct, spot.id + ' header');
    assert.deepEqual(spot.actions, db.spots[i].actions, spot.id + ' actions');
    assert.equal(spot.labels.raise, db.spots[i].labels.raise);
  });
});

check('every spot is a full 169-class strategy', () => {
  spots.validateDatabase(shipped, H.CLASSES);
  const ids = shipped.spots.map(s => s.id);
  for (const depth of [100, 75, 50]) {
    for (const seat of ['UTG', 'HJ', 'CO', 'BTN', 'SB']) {
      assert.ok(ids.indexOf('cash|6|' + depth + '|rfi:' + seat) >= 0, depth + ' ' + seat);
    }
  }
  shipped.spots.forEach(s => {
    assert.equal(Object.keys(s.hands).length, 169, s.id);
    assert.equal(s.source, 'reference');
    assert.ok(s.hands.AA.raise > 0.8, s.id + ' AA');
    assert.equal(s.hands['72o'].fold, 1, s.id + ' 72o');
  });
  const sb = shipped.spots.filter(s => /rfi:SB$/.test(s.id));
  assert.equal(sb.length, 3);
  sb.forEach(s => {
    assert.ok(s.actions.indexOf('limp') >= 0, s.id + ' limp action');
    assert.ok(s.hands.A2o.limp > 0, s.id + ' A2o limps');
    assert.equal(s.sizes.raise, 3);
  });
  const co100 = shipped.spots.find(s => s.id === 'cash|6|100|rfi:CO');
  const co50 = shipped.spots.find(s => s.id === 'cash|6|50|rfi:CO');
  assert.equal(co100.sizes.raise, 2.3);
  assert.equal(co50.sizes.raise, 2.2);
  assert.equal(shipped.spots.find(s => s.id === 'cash|6|100|rfi:UTG').sizes.raise, 2);
  assert.equal(shipped.spots.find(s => s.id === 'cash|6|100|rfi:BTN').sizes.raise, 2.5);
  const sb75 = shipped.spots.find(s => s.id === 'cash|6|75|rfi:SB');
  assert.equal(sb75.sizeUnconfirmed, true);
});

check('combo-weighted totals match the matrix headers within 1 percentage point', () => {
  const mismatches = [];
  db.spots.forEach(spot => {
    const live = gtow.comboTotals(spot.hands, H.CLASSES);
    assert.equal(live.combos, 1326, spot.id);
    const want = spot.headerPct;
    const rows = [
      ['fold', live.fold * 100, want.fold],
      ['raise', live.raise * 100, want.raise],
      ['limp', live.limp * 100, want.limp || 0]
    ];
    rows.forEach(([action, got, header]) => {
      const off = Math.abs(got - header);
      const line = spot.id + ' ' + action + ' ' + got.toFixed(3) + '% vs header ' + header.toFixed(1) + '% (off ' + off.toFixed(3) + ' pp)';
      if (off > 1) mismatches.push(line);
      else console.log('  ' + line);
    });
  });
  if (mismatches.length) {
    console.error('TOTALS OUTSIDE 1pp:\n' + mismatches.join('\n'));
  }
  assert.deepEqual(mismatches, [], 'positions outside 1 percentage point of the header');
});

check('no raw tokens were dropped', () => {
  assert.deepEqual(db.warnings, []);
  db.spots.forEach(s => {
    const sum = (s.totals.fold || 0) + (s.totals.raise || 0) + (s.totals.limp || 0);
    assert.ok(Math.abs(sum - 1) < 0.002, s.id + ' totals ' + sum);
  });
});

console.log(passed + ' passed');
