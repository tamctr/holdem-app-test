'use strict';
/*
  Precompute the cash spot database.
  Usage:
    node solver/equity.js 2000
    node solver/solve.js --iters 400
*/

const fs = require('fs');
const path = require('path');
const { loadCore } = require('./loadcore');
const equity = require('./equity');
const { buildTree, countSummary, MODEL, SEATS } = require('./tree');
const pre = require('./preflop');
const { solveHu } = require('./pushfold');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dflt;
  return process.argv[i + 1];
}

function main() {
  const iters = parseInt(arg('iters', '400'), 10);
  const exSamples = parseInt(arg('ex', '120'), 10);
  const H = loadCore();
  const { eq, live } = equity.loadEquity();
  const table = equity.classTable(H);
  pre.attachClasses(table, H.CLASSES);
  console.log('building tree');
  const nodes = buildTree();
  console.log(countSummary(nodes));
  console.log('solving', iters, 'iterations');
  const warmFrom = Math.round(iters * 0.45);
  const timing = pre.solve(nodes, eq, table, {
    iterations: iters, seed: 20261119, warmFrom: warmFrom,
    logEvery: Math.max(10, Math.round(iters / 12))
  });
  console.log('best-response exploitability, ' + exSamples + ' iterations each');
  const ex = pre.exploitability(nodes, eq, table, exSamples, 7);
  console.log(JSON.stringify(ex, null, 2));
  const metrics = {
    iterations: timing.iterations,
    warmFrom: timing.warmFrom,
    seconds: Math.round(timing.seconds * 10) / 10,
    trace: timing.trace,
    exploitability: ex,
    equity: '169x169 class-pair table, 1600 Monte Carlo boards per pair, card removal on the deal'
  };
  const db = pre.exportSpots(nodes, table, H.CLASSES, metrics);
  const counts = {};
  H.CLASSES.forEach(k => { counts[k] = H.classCount(k); });
  const countArr = H.CLASSES.map(k => counts[k]);
  console.log('push/fold');
  const pfStacks = [8, 10, 12];
  for (let s = 0; s < pfStacks.length; s++) {
    const pf = solveHu(eq, live, countArr, pfStacks[s], 400);
    console.log('HU', pfStacks[s] + 'bb', 'SB jam', pf.sbJamPct.toFixed(1) + '%', 'BB call', pf.bbCallPct.toFixed(1) + '%', 'ex', pf.exploitability.toFixed(4));
    db.spots.push(pushFoldSpot(H, pf, 'rfi:BTN', 'BTN', null, ['jam', 'fold'], pf.sbJam));
    db.spots.push(pushFoldSpot(H, pf, 'vs:BB:BTN', 'BB', 'BTN', ['call', 'fold'], pf.bbCall));
  }
  db.spots.sort((a, b) => a.id < b.id ? -1 : 1);
  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, 'cash-spots.json');
  fs.writeFileSync(jsonPath, JSON.stringify(db));
  const jsPath = path.join(dir, 'cash-spots.js');
  fs.writeFileSync(jsPath, 'window.HOLDEM_SPOTS = ' + JSON.stringify(db) + ';\n');
  console.log('wrote', jsonPath, 'spots', db.spots.length, 'bytes', fs.statSync(jsonPath).size);
  const rfi = db.spots.filter(s => /\|rfi:/.test(s.id) && s.stackBb === 100);
  for (const s of rfi) console.log(s.id, 'raise', ((s.totals.raise || 0) * 100).toFixed(1) + '%');
}

function pushFoldSpot(H, pf, sid, hero, villain, actions, freq) {
  const hands = {};
  const which = actions[0];
  for (let i = 0; i < H.CLASSES.length; i++) {
    const f = Math.round(freq[i] * 10000) / 10000;
    const cell = {};
    if (f >= 0.9999) cell[which] = 1;
    else if (f <= 0.0001) cell.fold = 1;
    else { cell[which] = f; cell.fold = Math.round((1 - f) * 10000) / 10000; }
    hands[H.CLASSES[i]] = cell;
  }
  return {
    id: 'cash|2|' + pf.stack + '|' + sid,
    source: 'solved',
    model: 'pushfold-cfr-v1',
    game: 'cash',
    tableSize: 2,
    stackBb: pf.stack,
    rake: { pct: 0, capBb: 0, preflop: 'none' },
    positions: ['BTN', 'BB'],
    hero: hero,
    villain: villain,
    actionHistory: villain ? ['BTN:jam'] : [],
    kind: villain ? 'vs-jam' : 'rfi',
    actions: actions,
    labels: which === 'jam' ? { jam: 'All-in ' + pf.stack + 'bb', fold: 'Fold' } : { call: 'Call', fold: 'Fold' },
    sizes: which === 'jam' ? { jam: pf.stack } : {},
    note: 'Heads-up push/fold, chip EV, no rake, no ante. Exact class-level CFR+ on the precomputed equity table.',
    hands: hands,
    totals: null,
    metrics: { exploitabilityBb: Math.round(pf.exploitability * 10000) / 10000, sbJamPct: Math.round(pf.sbJamPct * 10) / 10, bbCallPct: Math.round(pf.bbCallPct * 10) / 10 }
  };
}

main();
