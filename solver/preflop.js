'use strict';
const { SEATS, STACK, MODEL, chartAction } = require('./tree');
const { mulberry32 } = require('./loadcore');

const CLASSES = 169;

function payoff(node, trav, hands, eq) {
  const inv = node.invested[trav];
  if (node.kind === 'fold') return (node.winner === trav ? node.pot : 0) - inv;
  const live = node.live;
  const m = live.length;
  const share = payoff._s;
  if (m === 2) {
    const e = eq[hands[live[0]] * CLASSES + hands[live[1]]];
    share[0] = e;
    share[1] = 1 - e;
  } else {
    let sum = 0;
    for (let i = 0; i < m; i++) {
      let s = 1;
      const hi = hands[live[i]] * CLASSES;
      for (let j = 0; j < m; j++) if (j !== i) s *= eq[hi + hands[live[j]]];
      share[i] = s;
      sum += s;
    }
    if (sum <= 1e-12) {
      const u = 1 / m;
      for (let i = 0; i < m; i++) share[i] = u;
    } else {
      for (let i = 0; i < m; i++) share[i] /= sum;
    }
  }
  if (node.realize) {
    let sum = 0;
    for (let i = 0; i < m; i++) { share[i] *= node.erf[live[i]]; sum += share[i]; }
    if (sum <= 1e-12) sum = 1;
    for (let i = 0; i < m; i++) share[i] /= sum;
  }
  let mine = 0;
  for (let i = 0; i < m; i++) if (live[i] === trav) mine = share[i];
  return mine * (node.pot - node.rake) - inv;
}
payoff._s = new Float64Array(6);

function prepareDeal(table) {
  return {
    combos: table.combos,
    comboClass: table.comboClass,
    nCombos: table.comboClass.length,
    used: new Int32Array(52),
    stamp: 1,
    hands: new Int16Array(6)
  };
}

function dealOthers(ctx, heroSeat, comboIndex, rng) {
  let stamp = ++ctx.stamp;
  if (stamp > 0x7ffffffe) {
    ctx.used.fill(0);
    stamp = ctx.stamp = 1;
  }
  const used = ctx.used;
  const c0 = ctx.combos[comboIndex * 2];
  const c1 = ctx.combos[comboIndex * 2 + 1];
  used[c0] = stamp;
  used[c1] = stamp;
  const hands = ctx.hands;
  hands[heroSeat] = ctx.comboClass[comboIndex];
  const nCombos = ctx.nCombos;
  const combos = ctx.combos;
  for (let p = 0; p < 6; p++) if (p !== heroSeat) {
    for (;;) {
      const j = (rng() * nCombos) | 0;
      const a = combos[j * 2], b = combos[j * 2 + 1];
      if (used[a] !== stamp && used[b] !== stamp) {
        used[a] = stamp;
        used[b] = stamp;
        hands[p] = ctx.comboClass[j];
        break;
      }
    }
  }
  return hands;
}

function solve(nodes, eq, table, opts) {
  const iters = opts.iterations;
  const rng = mulberry32(opts.seed || 1);
  const ctx = prepareDeal(table);
  const sbuf = [];
  const ebuf = [];
  for (let d = 0; d < 32; d++) { sbuf.push(new Float64Array(4)); ebuf.push(new Float64Array(4)); }
  const nCombos = ctx.nCombos;
  const root = 0;
  let cursor = 0;

  function walk(id, hero, depth) {
    const node = nodes[id];
    if (node.term) return payoff(node, hero, ctx.hands, eq);
    const p = node.seat;
    const h = ctx.hands[p];
    const nA = node.nAct;
    const base = h * nA;
    const reg = node.regret;
    const s = sbuf[depth];
    let sum = 0;
    for (let a = 0; a < nA; a++) {
      const r = reg[base + a];
      const v = r > 0 ? r : 0;
      s[a] = v;
      sum += v;
    }
    if (sum <= 0) {
      const u = 1 / nA;
      for (let a = 0; a < nA; a++) s[a] = u;
    } else {
      for (let a = 0; a < nA; a++) s[a] /= sum;
    }
    const child = node.child;
    if (p === hero) {
      const evs = ebuf[depth];
      let ev = 0;
      for (let a = 0; a < nA; a++) {
        const u = walk(child[a], hero, depth + 1);
        evs[a] = u;
        ev += s[a] * u;
      }
      const ss = node.stratSum;
      const w = cursor;
      for (let a = 0; a < nA; a++) {
        const rg = reg[base + a] + (evs[a] - ev);
        reg[base + a] = rg > 0 ? rg : 0;
        ss[base + a] += w * s[a];
      }
      if (node.evSum) {
        node.evSum[h] += ev;
        node.evN[h]++;
      }
      return ev;
    }
    let r = rng();
    let a = nA - 1;
    for (let i = 0; i < nA; i++) {
      r -= s[i];
      if (r <= 0) { a = i; break; }
    }
    return walk(child[a], hero, depth + 1);
  }

  const t0 = Date.now();
  const logEvery = opts.logEvery || 25;
  const warm = Math.max(1, opts.warmFrom || 1);
  const trace = [];
  for (let t = 1; t <= iters; t++) {
    cursor = t < warm ? 0 : (t - warm + 1);
    for (let hero = 0; hero < 6; hero++) {
      for (let ci = 0; ci < nCombos; ci++) {
        dealOthers(ctx, hero, ci, rng);
        walk(root, hero, 0);
      }
    }
    if (t === 1 || t % logEvery === 0 || t === iters) {
      const pct = rfiPercent(nodes[0], table, nodes);
      const sec = (Date.now() - t0) / 1000;
      console.log('iter', t, 'UTG open', (pct.utg * 100).toFixed(1) + '%', 'BTN', (pct.btn * 100).toFixed(1) + '%',
        'AA', (pct.aa * 100).toFixed(0) + '%', '72o', (pct.trash * 100).toFixed(0) + '%',
        sec.toFixed(1) + 's');
      trace.push({ t: t, utg: round4(pct.utg), btn: round4(pct.btn), aa: round4(pct.aa), trash: round4(pct.trash) });
    }
  }
  return { seconds: (Date.now() - t0) / 1000, iterations: iters, warmFrom: warm, trace: trace };
}

function avgStrategy(node, hand, into) {
  const nA = node.nAct;
  const base = hand * nA;
  let sum = 0;
  for (let a = 0; a < nA; a++) { into[a] = node.stratSum[base + a]; sum += into[a]; }
  if (sum <= 0) {
    const u = 1 / nA;
    for (let a = 0; a < nA; a++) into[a] = u;
    return into;
  }
  for (let a = 0; a < nA; a++) into[a] /= sum;
  return into;
}

function findSpot(nodes, id) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.spot && n.spot.id === id) return n;
  }
  return null;
}

function rfiPercent(utgNode, table, nodes) {
  const buf = new Float64Array(4);
  const btn = nodes ? findSpot(nodes, 'rfi:BTN') : null;
  let raiseW = 0, total = 0, aa = 0, trash = 0;
  const ri = utgNode.actions.indexOf('r');
  for (let h = 0; h < CLASSES; h++) {
    avgStrategy(utgNode, h, buf);
    const n = table.byClass[h].length;
    raiseW += buf[ri] * n;
    total += n;
  }
  const aaI = classIndex(table, 'AA');
  const trI = classIndex(table, '72o');
  if (aaI >= 0) { avgStrategy(utgNode, aaI, buf); aa = buf[ri]; }
  if (trI >= 0) { avgStrategy(utgNode, trI, buf); trash = buf[ri]; }
  let btnP = 0;
  if (btn) {
    const bri = btn.actions.indexOf('r');
    let bw = 0, bt = 0;
    for (let h = 0; h < CLASSES; h++) {
      avgStrategy(btn, h, buf);
      const n = table.byClass[h].length;
      bw += buf[bri] * n;
      bt += n;
    }
    btnP = bw / bt;
  }
  return { utg: raiseW / total, btn: btnP, aa: aa, trash: trash };
}

function classIndex(table, name) {
  if (!table.classes) return -1;
  return table.classes.indexOf(name);
}

function attachClasses(table, classes) {
  table.classes = classes;
}

/**
 * Exploitability against the frozen average strategy.
 * Each player in turn trains a fresh external-sampling CFR best response while
 * the other five play the solved average strategy. The reported gain is the
 * best response's sampled EV minus the solved strategy's sampled EV.
 * Summed across players this is the standard multiplayer exploitability
 * (how much everyone can improve by deviating alone). It is itself Monte Carlo.
 */
function exploitability(nodes, eq, table, brIters, seed) {
  const rng = mulberry32(seed || 99);
  const ctx = prepareDeal(table);
  const sbuf = [];
  const ebuf = [];
  for (let d = 0; d < 32; d++) { sbuf.push(new Float64Array(4)); ebuf.push(new Float64Array(4)); }
  const decisions = [];
  for (let i = 0; i < nodes.length; i++) if (!nodes[i].term) decisions.push(nodes[i]);
  for (let i = 0; i < decisions.length; i++) {
    const n = decisions[i];
    n.brR = new Float64Array(n.regret.length);
    n.brS = new Float64Array(n.regret.length);
  }
  const brBuf = new Float64Array(4);

  function stratFrom(store, node, hand, into) {
    const nA = node.nAct;
    const base = hand * nA;
    let sum = 0;
    for (let a = 0; a < nA; a++) { into[a] = store[base + a]; sum += into[a]; }
    if (sum <= 0) {
      const u = 1 / nA;
      for (let a = 0; a < nA; a++) into[a] = u;
    } else for (let a = 0; a < nA; a++) into[a] /= sum;
  }
  function sampleAction(probs, nA) {
    let r = rng();
    for (let i = 0; i < nA; i++) { r -= probs[i]; if (r <= 0) return i; }
    return nA - 1;
  }
  function walkBr(id, hero, depth, t) {
    const node = nodes[id];
    if (node.term) return payoff(node, hero, ctx.hands, eq);
    const p = node.seat;
    const h = ctx.hands[p];
    const nA = node.nAct;
    const s = sbuf[depth];
    if (p !== hero) {
      avgStrategy(node, h, s);
      return walkBr(node.child[sampleAction(s, nA)], hero, depth + 1, t);
    }
    const base = h * nA;
    let sum = 0;
    for (let a = 0; a < nA; a++) {
      const r = node.brR[base + a];
      s[a] = r > 0 ? r : 0;
      sum += s[a];
    }
    if (sum <= 0) { const u = 1 / nA; for (let a = 0; a < nA; a++) s[a] = u; }
    else for (let a = 0; a < nA; a++) s[a] /= sum;
    const evs = ebuf[depth];
    let ev = 0;
    for (let a = 0; a < nA; a++) {
      evs[a] = walkBr(node.child[a], hero, depth + 1, t);
      ev += s[a] * evs[a];
    }
    for (let a = 0; a < nA; a++) {
      const rg = node.brR[base + a] + (evs[a] - ev);
      node.brR[base + a] = rg > 0 ? rg : 0;
      node.brS[base + a] += t * s[a];
    }
    return ev;
  }
  function currentBr(node, hand, into) {
    const nA = node.nAct;
    const base = hand * nA;
    let sum = 0;
    for (let a = 0; a < nA; a++) {
      const r = node.brR[base + a];
      into[a] = r > 0 ? r : 0;
      sum += into[a];
    }
    if (sum <= 0) { const u = 1 / nA; for (let a = 0; a < nA; a++) into[a] = u; }
    else for (let a = 0; a < nA; a++) into[a] /= sum;
  }
  function walkEval(id, hero, depth, heroStore) {
    const node = nodes[id];
    if (node.term) return payoff(node, hero, ctx.hands, eq);
    const p = node.seat;
    const s = sbuf[depth];
    if (p === hero && heroStore === 'br') currentBr(node, ctx.hands[p], s);
    else avgStrategy(node, ctx.hands[p], s);
    return walkEval(node.child[sampleAction(s, node.nAct)], hero, depth + 1, heroStore);
  }

  const players = {};
  let sumGain = 0;
  const evalN = 2000;
  for (let hero = 0; hero < 6; hero++) {
    for (let i = 0; i < decisions.length; i++) { decisions[i].brR.fill(0); decisions[i].brS.fill(0); }
    for (let t = 1; t <= brIters; t++) {
      for (let ci = 0; ci < ctx.nCombos; ci++) {
        dealOthers(ctx, hero, ci, rng);
        walkBr(0, hero, 0, t);
      }
    }
    let evBr = 0, evAvg = 0, acc2 = 0;
    for (let s = 0; s < evalN; s++) {
      const ci = (rng() * ctx.nCombos) | 0;
      dealOthers(ctx, hero, ci, rng);
      const snap = new Int16Array(ctx.hands);
      const a = walkEval(0, hero, 0, 'avg');
      ctx.hands.set(snap);
      const b = walkEval(0, hero, 0, 'br');
      evAvg += a;
      evBr += b;
      const d = b - a;
      acc2 += d * d;
    }
    evBr /= evalN;
    evAvg /= evalN;
    const gain = evBr - evAvg;
    const stderr = Math.sqrt(Math.max(0, acc2 / evalN - gain * gain) / Math.max(1, evalN - 1));
    sumGain += gain;
    players[SEATS[hero]] = {
      strategyEvBb: round3(evAvg), bestResponseEvBb: round3(evBr),
      gainBb: round3(gain), gainStderrBb: round3(stderr)
    };
    console.log('BR', SEATS[hero], 'gain', gain.toFixed(3), '±', stderr.toFixed(3), 'bb/hand');
  }
  for (let i = 0; i < decisions.length; i++) { decisions[i].brR = null; decisions[i].brS = null; }
  return {
    method: 'Each player trains an external-sampling CFR best response for ' + brIters + ' iterations against the other five frozen on the solved average strategy. The gain is the last-iterate response minus the solved strategy, re-sampled on ' + evalN + ' paired deals (stderr is the standard error of that mean). Sum of gains is multiplayer exploitability of this model. A gain inside the noise is consistent with an approximate equilibrium.',
    bestResponseIterations: brIters,
    evalDealsPerPlayer: evalN,
    gainBbPerHand: round3(sumGain),
    gainBbPer100: round3(sumGain * 100),
    players: players
  };
}

function round3(x) { return Math.round(x * 1000) / 1000; }
function round4(x) { return Math.round(x * 10000) / 10000; }

function exportSpots(nodes, table, classes, metrics) {
  const buf = new Float64Array(4);
  const spots = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node.spot) continue;
    const kind = node.spot.kind;
    const hands = {};
    const totals = {};
    let comboSum = 0;
    const actionNames = node.actions.map(a => chartAction(kind, a));
    for (let a = 0; a < actionNames.length; a++) totals[actionNames[a]] = 0;
    for (let h = 0; h < CLASSES; h++) {
      avgStrategy(node, h, buf);
      const name = classes[h];
      const n = table.byClass[h].length;
      comboSum += n;
      const cell = {};
      let acc = 0;
      let best = 0;
      for (let a = 0; a < node.nAct; a++) {
        let f = buf[a];
        if (f < 0.0005) f = 0;
        f = round4(f);
        if (f > 0) { cell[actionNames[a]] = f; acc += f; if (f > best) best = f; }
        totals[actionNames[a]] += buf[a] * n;
      }
      if (acc <= 0) cell.fold = 1;
      else if (Math.abs(acc - 1) > 0.001) {
        // rounding dust: rescale so the cell sums to 1
        for (const k of Object.keys(cell)) cell[k] = round4(cell[k] / acc);
        let s2 = 0;
        const ks = Object.keys(cell);
        for (let k = 0; k < ks.length; k++) s2 += cell[ks[k]];
        const dust = round4(1 - s2);
        if (Math.abs(dust) >= 0.0001) cell[ks[ks.length - 1]] = round4(cell[ks[ks.length - 1]] + dust);
      }
      if (node.evN && node.evN[h] >= 30) cell.ev = round3(node.evSum[h] / node.evN[h]);
      hands[name] = cell;
    }
    for (const k of Object.keys(totals)) totals[k] = round4(totals[k] / comboSum);
    const labels = {};
    const sizes = {};
    for (let a = 0; a < node.nAct; a++) {
      const nm = actionNames[a];
      const child = nodes[node.child[a]];
      if (nm === 'fold') labels[nm] = 'Fold';
      else if (nm === 'call') labels[nm] = 'Call';
      else if (nm === 'jam') { labels[nm] = 'All-in'; sizes[nm] = STACK; }
      else if (nm === 'raise') { labels[nm] = 'Raise ' + trimNum(child.betTo) + 'bb'; sizes[nm] = child.betTo; }
      else if (nm === '3bet') { labels[nm] = '3-Bet ' + trimNum(child.betTo) + 'bb'; sizes[nm] = child.betTo; }
      else if (nm === '4bet') { labels[nm] = '4-Bet ' + trimNum(child.betTo) + 'bb'; sizes[nm] = child.betTo; }
      else { labels[nm] = nm; if (child && child.betTo) sizes[nm] = child.betTo; }
    }
    const facing = node.betTo > 1 ? node.betTo : 0;
    spots.push({
      id: 'cash|6|100|' + node.spot.id,
      source: 'solved',
      model: MODEL.id,
      game: 'cash',
      tableSize: 6,
      stackBb: 100,
      rake: { pct: MODEL.rake.pct, capBb: MODEL.rake.capBb, preflop: 'no-flop-no-drop' },
      positions: SEATS.slice(),
      hero: node.spot.hero,
      villain: node.spot.villain,
      actionHistory: node.history ? node.history.slice(1).split('/') : [],
      kind: node.spot.kind,
      betToFaceBb: facing || null,
      actions: actionNames,
      labels: labels,
      sizes: sizes,
      hands: hands,
      totals: totals
    });
  }
  spots.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    format: 'holdem-lab.spots',
    version: 1,
    model: MODEL,
    metrics: metrics,
    spots: spots
  };
}

function trimNum(x) {
  const r = Math.round(x * 100) / 100;
  return (Math.round(r * 4) / 4).toString();
}

module.exports = {
  solve: solve, exportSpots: exportSpots, exploitability: exploitability,
  avgStrategy: avgStrategy, attachClasses: attachClasses, findSpot: findSpot, rfiPercent: rfiPercent
};
