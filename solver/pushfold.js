'use strict';
/*
  Heads-up push/fold equilibrium. Chip EV, no rake, no ante.
  SB jams or folds. BB calls or folds. No other actions.
  Solved by CFR+ (regret-matching+, linear average) on the 169 classes
  with combo weights and exact card-removal fractions.
*/

function solveHu(eq, live, counts, stack, iterations) {
  const n = counts.length;
  const S = stack;
  const regS = new Float64Array(n * 2);
  const regB = new Float64Array(n * 2);
  const sumS = new Float64Array(n * 2);
  const sumB = new Float64Array(n * 2);
  const jam = new Float64Array(n);
  const call = new Float64Array(n);

  function sync(reg, into) {
    for (let h = 0; h < n; h++) {
      const fold = reg[h * 2] > 0 ? reg[h * 2] : 0;
      const agg = reg[h * 2 + 1] > 0 ? reg[h * 2 + 1] : 0;
      const s = fold + agg;
      into[h] = s <= 0 ? 0.5 : agg / s;
    }
  }
  function floorPair(reg, h) {
    if (reg[h * 2] < 0) reg[h * 2] = 0;
    if (reg[h * 2 + 1] < 0) reg[h * 2 + 1] = 0;
  }

  for (let t = 1; t <= iterations; t++) {
    sync(regS, jam);
    sync(regB, call);
    for (let i = 0; i < n; i++) {
      let num = 0, den = 0;
      const row = i * n;
      for (let j = 0; j < n; j++) {
        const lv = live[row + j];
        if (lv <= 0) continue;
        const w = counts[j] * lv;
        den += w;
        const e = eq[row + j];
        num += w * (call[j] * (2 * S * e - S) + (1 - call[j]) * 1);
      }
      const evJam = den > 0 ? num / den : 0;
      const evFold = -0.5;
      const ev = jam[i] * evJam + (1 - jam[i]) * evFold;
      regS[i * 2] += evFold - ev;
      regS[i * 2 + 1] += evJam - ev;
      floorPair(regS, i);
      sumS[i * 2] += t * (1 - jam[i]);
      sumS[i * 2 + 1] += t * jam[i];
    }
    for (let j = 0; j < n; j++) {
      let num = 0, den = 0, reachMass = 0;
      const row = j * n;
      for (let i = 0; i < n; i++) {
        const lv = live[row + i];
        if (lv <= 0) continue;
        const w = counts[i] * lv;
        den += w;
        reachMass += w * jam[i];
        num += w * jam[i] * (2 * S * eq[row + i] - S);
      }
      const reach = den > 0 ? reachMass / den : 0;
      const evCall = reachMass > 0 ? num / reachMass : 0;
      const evFold = -1;
      const c = call[j];
      const ev = c * evCall + (1 - c) * evFold;
      regB[j * 2] += reach * (evFold - ev);
      regB[j * 2 + 1] += reach * (evCall - ev);
      floorPair(regB, j);
      sumB[j * 2] += t * (1 - c);
      sumB[j * 2 + 1] += t * c;
    }
  }

  function avg(sum, h) {
    const f = sum[h * 2], a = sum[h * 2 + 1], s = f + a;
    if (s <= 0) return [0.5, 0.5];
    return [f / s, a / s];
  }
  const sb = new Array(n), bb = new Array(n);
  for (let h = 0; h < n; h++) { sb[h] = avg(sumS, h)[1]; bb[h] = avg(sumB, h)[1]; }

  // Exact exploitability: best response value minus strategy value, both players.
  function sbEv(jamP, callP) {
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      let jn = 0, jd = 0;
      const row = i * n;
      for (let j = 0; j < n; j++) {
        const lv = live[row + j];
        if (lv <= 0) continue;
        const w = counts[j] * lv;
        jd += w;
        const e = eq[row + j];
        jn += w * (callP[j] * (2 * S * e - S) + (1 - callP[j]));
      }
      const evJam = jd > 0 ? jn / jd : 0;
      const ev = jamP[i] * evJam + (1 - jamP[i]) * -0.5;
      const w = counts[i];
      num += w * ev;
      den += w;
    }
    return num / den;
  }
  function bbEv(jamP, callP) {
    let num = 0, den = 0;
    for (let j = 0; j < n; j++) {
      let mass = 0, tot = 0, callNum = 0;
      const row = j * n;
      for (let i = 0; i < n; i++) {
        const lv = live[row + i];
        if (lv <= 0) continue;
        const w = counts[i] * lv;
        tot += w;
        mass += w * jamP[i];
        callNum += w * jamP[i] * (2 * S * eq[row + i] - S);
      }
      const reach = tot > 0 ? mass / tot : 0;
      const evCall = mass > 0 ? callNum / mass : 0;
      const evFold = -1;
      // When SB folds, BB wins +0.5, which is not in this node. Strategy value of the whole hand:
      // P(SB folds) * 0.5 + P(SB jams) * (call decision).
      const pJam = reach;
      const ev = (1 - pJam) * 0.5 + pJam * (callP[j] * evCall + (1 - callP[j]) * evFold);
      num += counts[j] * ev;
      den += counts[j];
    }
    return num / den;
  }
  function brSb(callP) {
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let jn = 0, jd = 0;
      const row = i * n;
      for (let j = 0; j < n; j++) {
        const lv = live[row + j];
        if (lv <= 0) continue;
        const w = counts[j] * lv;
        jd += w;
        jn += w * (callP[j] * (2 * S * eq[row + j] - S) + (1 - callP[j]));
      }
      const evJam = jd > 0 ? jn / jd : 0;
      p[i] = evJam > -0.5 ? 1 : 0;
    }
    return p;
  }
  function brBb(jamP) {
    const p = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let mass = 0, callNum = 0;
      const row = j * n;
      for (let i = 0; i < n; i++) {
        const lv = live[row + i];
        if (lv <= 0) continue;
        const w = counts[i] * lv * jamP[i];
        mass += w;
        callNum += w * (2 * S * eq[row + i] - S);
      }
      const evCall = mass > 0 ? callNum / mass : 0;
      p[j] = evCall > -1 ? 1 : 0;
    }
    return p;
  }
  const sbArr = Float64Array.from(sb);
  const bbArr = Float64Array.from(bb);
  const sbBr = brSb(bbArr);
  const bbBr = brBb(sbArr);
  const sVal = sbEv(sbArr, bbArr);
  const bVal = bbEv(sbArr, bbArr);
  const sBr = sbEv(sbBr, bbArr);
  const bBr = bbEv(sbArr, bbBr);
  let jamCombos = 0, callCombos = 0, total = 0;
  for (let h = 0; h < n; h++) {
    jamCombos += sb[h] * counts[h];
    callCombos += bb[h] * counts[h];
    total += counts[h];
  }
  return {
    stack: S,
    sbJam: sb,
    bbCall: bb,
    sbJamPct: 100 * jamCombos / total,
    bbCallPct: 100 * callCombos / total,
    exploitability: (sBr - sVal) + (bBr - bVal),
    sbValue: sVal,
    bbValue: bVal
  };
}

module.exports = { solveHu: solveHu };
