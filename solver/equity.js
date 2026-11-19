'use strict';
const fs = require('fs');
const path = require('path');
const { loadCore, mulberry32 } = require('./loadcore');

const N = 169;

function classTable(H) {
  const classOf = new Int16Array(52 * 52);
  classOf.fill(-1);
  const combos = [];
  const comboClass = [];
  const byClass = H.CLASSES.map(() => []);
  H.CLASSES.forEach((k, idx) => {
    H.classCombos(k).forEach(pair => {
      const a = pair[0], b = pair[1];
      classOf[a * 52 + b] = idx;
      classOf[b * 52 + a] = idx;
      const ci = comboClass.length;
      combos.push(a, b);
      comboClass.push(idx);
      byClass[idx].push(ci);
    });
  });
  return { classOf: classOf, combos: combos, comboClass: comboClass, byClass: byClass };
}

/** Exact fraction of combo pairs with disjoint cards. Symmetric. */
function liveMatrix(table) {
  const live = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    const A = table.byClass[i];
    for (let j = i; j < N; j++) {
      const B = table.byClass[j];
      let ok = 0;
      for (let x = 0; x < A.length; x++) {
        const a0 = table.combos[A[x] * 2], a1 = table.combos[A[x] * 2 + 1];
        for (let y = 0; y < B.length; y++) {
          const b0 = table.combos[B[y] * 2], b1 = table.combos[B[y] * 2 + 1];
          if (a0 !== b0 && a0 !== b1 && a1 !== b0 && a1 !== b1) ok++;
        }
      }
      const f = ok / (A.length * B.length);
      live[i * N + j] = f;
      live[j * N + i] = f;
    }
  }
  return live;
}

function buildEquity(H, samplesPerPair, seed) {
  const rng = mulberry32(seed || 1);
  const table = classTable(H);
  const live = liveMatrix(table);
  const eq = new Float32Array(N * N);
  const cnt = new Uint32Array(N * N);
  const deck = new Uint8Array(52);
  const h1 = [0, 0, 0, 0, 0, 0, 0];
  const h2 = [0, 0, 0, 0, 0, 0, 0];
  const t0 = Date.now();
  let evals = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      if (live[i * N + j] <= 0) {
        eq[i * N + j] = 0.5;
        eq[j * N + i] = 0.5;
        continue;
      }
      const A = table.byClass[i];
      const B = table.byClass[j];
      let acc = 0, n = 0, guardFail = 0;
      for (let s = 0; s < samplesPerPair; s++) {
        let a0, a1, b0, b1, guard = 0, ok = false;
        while (guard++ < 40) {
          const ia = A[(rng() * A.length) | 0];
          const ib = B[(rng() * B.length) | 0];
          a0 = table.combos[ia * 2]; a1 = table.combos[ia * 2 + 1];
          b0 = table.combos[ib * 2]; b1 = table.combos[ib * 2 + 1];
          if (a0 !== b0 && a0 !== b1 && a1 !== b0 && a1 !== b1) { ok = true; break; }
        }
        if (!ok) { guardFail++; continue; }
        for (let c = 0; c < 52; c++) deck[c] = c;
        // move the four hole cards to the end so the first 48 are the board deck
        function bury(card, last) {
          const at = deck.indexOf(card);
          deck[at] = deck[last];
          deck[last] = card;
        }
        bury(a0, 51); bury(a1, 50); bury(b0, 49); bury(b1, 48);
        for (let k = 0; k < 5; k++) {
          const r = k + ((rng() * (48 - k)) | 0);
          const tmp = deck[k]; deck[k] = deck[r]; deck[r] = tmp;
        }
        h1[0] = a0; h1[1] = a1; h2[0] = b0; h2[1] = b1;
        for (let k = 0; k < 5; k++) { h1[k + 2] = deck[k]; h2[k + 2] = deck[k]; }
        const s0 = H.evalHand(h1, 7);
        const s1 = H.evalHand(h2, 7);
        acc += s0 > s1 ? 1 : s0 < s1 ? 0 : 0.5;
        n++;
      }
      const e = n ? acc / n : 0.5;
      eq[i * N + j] = e;
      eq[j * N + i] = 1 - e;
      cnt[i * N + j] = n;
      cnt[j * N + i] = n;
      evals += n;
      if (guardFail) { /* a pair of classes with almost no live combos */ }
    }
    if ((i + 1) % 40 === 0) console.log('equity rows', i + 1, 'evals', evals, 's', ((Date.now() - t0) / 1000).toFixed(1));
  }
  return { eq: eq, cnt: cnt, live: live, table: table, samplesPerPair: samplesPerPair };
}

/** Exact equity of one concrete combo versus another. C(48,5) boards. */
function exactComboEquity(H, a0, a1, b0, b1) {
  const dead = new Uint8Array(52);
  dead[a0] = dead[a1] = dead[b0] = dead[b1] = 1;
  const board = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) board.push(c);
  const h1 = [a0, a1, 0, 0, 0, 0, 0];
  const h2 = [b0, b1, 0, 0, 0, 0, 0];
  let acc = 0, n = 0;
  const L = board.length;
  for (let i = 0; i < L; i++) for (let j = i + 1; j < L; j++) for (let k = j + 1; k < L; k++)
    for (let t = k + 1; t < L; t++) for (let u = t + 1; u < L; u++) {
      h1[2] = h2[2] = board[i];
      h1[3] = h2[3] = board[j];
      h1[4] = h2[4] = board[k];
      h1[5] = h2[5] = board[t];
      h1[6] = h2[6] = board[u];
      const s0 = H.evalHand(h1, 7);
      const s1 = H.evalHand(h2, 7);
      acc += s0 > s1 ? 1 : s0 < s1 ? 0 : 0.5;
      n++;
    }
  return { equity: acc / n, boards: n };
}

function equityPath() { return path.join(__dirname, '..', 'data', 'equity-169.f32'); }
function livePath() { return path.join(__dirname, '..', 'data', 'live-169.f32'); }

function saveEquity(eq, live) {
  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
  fs.writeFileSync(equityPath(), Buffer.from(eq.buffer, eq.byteOffset, eq.byteLength));
  if (live) fs.writeFileSync(livePath(), Buffer.from(live.buffer, live.byteOffset, live.byteLength));
}

function loadEquity() {
  const buf = fs.readFileSync(equityPath());
  const eq = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  let live = null;
  if (fs.existsSync(livePath())) {
    const lb = fs.readFileSync(livePath());
    live = new Float32Array(lb.buffer, lb.byteOffset, lb.byteLength / 4);
  }
  return { eq: eq, live: live };
}

function checkSanity(H, eq) {
  const ix = {};
  H.CLASSES.forEach((k, i) => { ix[k] = i; });
  function e(a, b) { return eq[ix[a] * N + ix[b]]; }
  const rows = [
    ['AA', 'KK', e('AA', 'KK')],
    ['AA', 'QQ', e('AA', 'QQ')],
    ['AA', 'AKs', e('AA', 'AKs')],
    ['AA', '72o', e('AA', '72o')],
    ['AKs', 'QQ', e('AKs', 'QQ')],
    ['22', 'AA', e('22', 'AA')]
  ];
  return rows;
}

if (require.main === module) {
  const samples = parseInt(process.argv[2] || '1200', 10);
  const H = loadCore();
  console.log('building', samples, 'boards per class pair');
  const { eq, live } = buildEquity(H, samples, 0xC0FFEE);
  saveEquity(eq, live);
  console.log(checkSanity(H, eq).map(r => r[0] + ' vs ' + r[1] + ' ' + (r[2] * 100).toFixed(1) + '%').join('\n'));
  console.log('wrote', equityPath());
}

module.exports = {
  N: N, classTable: classTable, liveMatrix: liveMatrix, buildEquity: buildEquity, exactComboEquity: exactComboEquity,
  saveEquity: saveEquity, loadEquity: loadEquity, checkSanity: checkSanity, equityPath: equityPath
};
