'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const G = require('../data/gtow/gtowlib');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

const APP = path.join(__dirname, '..', 'data', 'gtow', 'app');
const index = JSON.parse(fs.readFileSync(path.join(APP, 'index.json'), 'utf8'));

function load(gt) {
  const meta = Object.assign({ gametype: gt }, index.libraries[gt]);
  const doc = JSON.parse(fs.readFileSync(path.join(APP, meta.file), 'utf8'));
  const byId = {};
  doc.spots.forEach(p => { byId[p.id] = G.decode(p, meta); });
  return byId;
}

check('index covers the whole hand-read library', () => {
  assert.equal(index.format, 'holdem-lab.gtow-index');
  assert.equal(index.n_spots, 1013);
  assert.equal(Object.keys(index.libraries).length, 28);
  let n = 0;
  Object.keys(index.catalog).forEach(gt => { n += index.catalog[gt].length; });
  assert.equal(n, 1013);
  const raw = fs.readdirSync(path.join(__dirname, '..', 'data', 'gtow', 'raw')).filter(f => f.endsWith('.txt'));
  assert.equal(raw.length, 804);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'data', 'gtow', 'build.py')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'data', 'gtow', 'README.md')));
});

check('source order is import, then GTO Wizard, then solved, then heuristic', () => {
  assert.equal(G.pickSource(true, true, true), 'imported');
  assert.equal(G.pickSource(false, true, true), 'reference');
  assert.equal(G.pickSource(false, false, true), 'solved');
  assert.equal(G.pickSource(false, false, false), 'heuristic');
});

check('6-max 100bb BTN open matches the NL50 reference shape', () => {
  const spot = load('Cash6m50zGeneral')['cash|6|100|rfi:BTN'];
  assert.equal(spot.depth, 100);
  assert.equal(spot.hero, 'BTN');
  assert.equal(spot.sizes.raise, 2.5);
  assert.equal(spot.overall.raise, 42);
  assert.equal(G.sourceLabel(spot), 'GTO Wizard reference (NL50, General)');
  assert.equal(G.labelsFor(spot).raise, 'Raise 2.5bb');
  const chart = G.chartFromSpot(spot);
  assert.ok(chart.AA.raise > 0.8);
  assert.equal(chart['72o'].fold, 1);
  assert.equal(chart.AA.limp || 0, 0);
  const sb = load('Cash6m50zGeneral')['cash|6|100|rfi:SB'];
  const sbChart = G.chartFromSpot(sb);
  assert.ok(sbChart.A2o.limp > 0, 'SB limp stays a limp');
  assert.equal(G.labelsFor(sb).limp, 'Limp');
  const sb75 = load('Cash6m50zGeneral')['cash|6|75|rfi:SB'];
  assert.equal(sb75.sizeUnconfirmed, true);
  assert.ok(/not on the matrix/.test(G.caveat(sb75)));
  const vl = load('Cash6m50zGeneral')['cash|6|100|vl:SB:BB:R3'];
  assert.equal(vl.rescale, 0.6357);
  assert.ok(/rescaled/.test(G.caveat(vl)));
});

check('heads-up, 9-max and 8-max spots decode with distinct sizes', () => {
  const hu = load('CashHu500zComplex')['cash|2|100|complex|vs:BB:SB'];
  assert.equal(hu.hero, 'BB');
  assert.equal(hu.villain, 'SB');
  assert.equal(hu.kind, 'vs');
  assert.ok(hu.overall.call > 30);
  assert.equal(G.title(hu), 'BB vs SB open');
  assert.equal(G.sourceLabel(hu), 'GTO Wizard reference (HU NL500 Complex)');
  const limp = load('CashHu500zComplex')['cash|2|100|complex|vs:BB:SB:limp'];
  assert.ok(limp.sizes.raise && limp.sizes.raise2 && limp.sizes.raise3);
  const labs = G.labelsFor(limp);
  assert.notEqual(labs.raise, labs.raise2);
  assert.notEqual(labs.raise2, labs.raise3);
  assert.ok(G.actionsFor(limp).indexOf('jam') < 0);
  const utg = load('Cash9m50zGeneral')['cash|9|100|rfi:UTG'];
  assert.equal(utg.sizes.raise, 2);
  assert.ok(/under 0\.5%/.test(G.caveat(utg)));
  assert.equal(G.sourceLabel(utg), 'GTO Wizard reference (9-max NL50)');
  const eight = index.libraries.Cash8mLiveGeneral_8mcEVR2;
  assert.equal(eight.rake, 'cEV');
  assert.equal(eight.open, '2');
  assert.equal(eight.coldCalls, true);
  assert.ok(eight.depths.indexOf(100) >= 0 && eight.depths.indexOf(300) >= 0);
  const rfi = load('Cash8mLiveGeneral_8mcEVR2')['cash|8|100|rfi:UTG'];
  assert.equal(rfi.sizes.raise, 2);
  assert.ok(/cold calls/.test(G.sourceLabel(rfi)));
  const live = index.libraries.Cash8mLiveGeneral_8mLIVER3;
  assert.equal(live.rake, 'LIVE');
  assert.equal(live.open, '3');
  assert.equal(live.coldCalls, false);
});

check('combo-weighted totals stay within 1.2pp of every header', () => {
  const bad = [];
  Object.keys(index.libraries).forEach(gt => {
    const byId = load(gt);
    Object.keys(byId).forEach(id => {
      const spot = byId[id];
      const live = G.comboOverall(spot);
      ['fold', 'call', 'raise', 'raise2', 'raise3', 'allin'].forEach(a => {
        const off = Math.abs(live.pct[a] - (spot.overall[a] || 0));
        if (off > 1.2) bad.push(id + ' ' + a + ' off ' + off.toFixed(3));
      });
      const chart = G.chartFromSpot(spot);
      G.HANDS.forEach(h => {
        const cell = chart[h];
        let s = 0;
        Object.keys(cell).forEach(k => { s += cell[k]; });
        if (Math.abs(s - 1) > 0.002) bad.push(id + ' ' + h + ' sum ' + s);
      });
    });
  });
  assert.deepEqual(bad, []);
});

check('spot types group limp separately from a raise-open', () => {
  const ids = index.catalog.Cash6m50zGeneral.map(G.parseId);
  const bb = ids.filter(s => s.depth === 100 && s.hero === 'BB' && s.villain === 'SB');
  assert.ok(bb.some(s => G.matchType(s, 'vs') && !s.node));
  assert.ok(bb.some(s => G.matchType(s, 'vl') && s.node === 'limp'));
  assert.equal(G.nodeLabel('R6.5:AI'), '6.5bb · all-in');
  assert.equal(G.nodeLabel(''), 'Main');
});

console.log(passed + ' passed');
