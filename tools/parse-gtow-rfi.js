'use strict';
/*
  Turn hand-read GTO Wizard first-in charts into the spot database the app ships.

  The raw files in data/raw/ were copied off a matrix by hand. This script does
  not contact GTO Wizard. Run it again after editing a raw file:

    node tools/parse-gtow-rfi.js

  Format (see the header of each raw file):
    HAND:R<pct>     raise percent, rest fold. Bare R is a pure raise.
    HAND:R<pct>/C<pct>   SB only: raise / limp. Remainder folds.
    HAND:C<pct>     limp percent, rest fold.
    Hands that are not listed are a pure fold.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const JSON_PATH = path.join(ROOT, 'data', 'reference-gtow-cash.json');
const JS_PATH = path.join(ROOT, 'data', 'reference-gtow-cash.js');
const RAW_FILES = [
  'cash6m_nl50_100bb_rfi.txt',
  'cash6m_nl50_75bb_rfi.txt',
  'cash6m_nl50_50bb_rfi.txt'
];

const LABEL = 'GTO Wizard reference (NL50, General)';
function round4(x) { return Math.round(x * 10000) / 10000; }

function classCount(key) {
  return key.length === 2 ? 6 : key[2] === 's' ? 4 : 12;
}

function canonHand(token) {
  const m = String(token || '').match(/^([2-9TJQKA])([2-9TJQKA])([so])?$/i);
  if (!m) return null;
  const ranks = '23456789TJQKA';
  let a = m[1].toUpperCase(), b = m[2].toUpperCase(), so = m[3] ? m[3].toLowerCase() : '';
  if (a === b) return so ? null : a + b;
  if (!so) return null;
  if (ranks.indexOf(a) < ranks.indexOf(b)) { const t = a; a = b; b = t; }
  return a + b + so;
}

function makeCell(raisePct, limpPct) {
  let r = raisePct > 0 ? round4(raisePct / 100) : 0;
  let c = limpPct > 0 ? round4(limpPct / 100) : 0;
  let scaled = false;
  if (r + c > 1) {
    const s = r + c;
    r = round4(r / s);
    c = round4(c / s);
    scaled = true;
  }
  let fold = round4(1 - r - c);
  if (fold < 0) fold = 0;
  const cell = {};
  if (r > 0) cell.raise = r;
  if (c > 0) cell.limp = c;
  if (fold > 0 || (!r && !c)) cell.fold = fold > 0 ? fold : 1;
  const keys = Object.keys(cell);
  let sum = 0;
  for (let i = 0; i < keys.length; i++) sum += cell[keys[i]];
  const dust = round4(1 - sum);
  if (dust) cell[cell.fold != null ? 'fold' : keys[0]] = round4(cell[cell.fold != null ? 'fold' : keys[0]] + dust);
  return { cell: cell, scaled: scaled };
}

function parseToken(token) {
  const m = token.match(/^([2-9TJQKA]{2}[so]?):(R(\d+(?:\.\d+)?)?(?:\/C(\d+(?:\.\d+)?))?|C(\d+(?:\.\d+)?)?)$/i);
  if (!m) return null;
  const hand = canonHand(m[1]);
  if (!hand) return null;
  if (m[2] && m[2].charAt(0).toUpperCase() === 'C' && m[2].charAt(1) !== '/') {
    return { hand: hand, raise: 0, limp: m[5] == null || m[5] === '' ? 100 : parseFloat(m[5]) };
  }
  return {
    hand: hand,
    raise: m[3] == null || m[3] === '' ? 100 : parseFloat(m[3]),
    limp: m[4] == null || m[4] === '' ? 0 : parseFloat(m[4])
  };
}

function trimSize(n) {
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(Math.round(n * 100) / 100);
}

function parseFile(text, filename) {
  const warnings = [];
  const depthM = text.match(/Cash\s+(\d+)\s*bb/i) || text.match(/depth=(\d+)/i);
  if (!depthM) throw new Error(filename + ': no stack depth in the header');
  const depth = parseInt(depthM[1], 10);
  const lines = text.split(/\r?\n/);
  const spots = [];
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].match(/^##\s+([A-Z0-9+]+)\s+\(([^)]*)\)/);
    if (!hm) continue;
    const hero = hm[1];
    const inner = hm[2];
    const foldM = inner.match(/Fold\s+([\d.]+)\s*%/i);
    const raiseM = inner.match(/Raise\s+(~)?\s*([\d.]+)\s+([\d.]+)\s*%/i);
    const callM = inner.match(/Call\s+([\d.]+)\s*%/i);
    if (!foldM || !raiseM) throw new Error(filename + ': ' + hero + ' header is missing Fold/Raise');
    const sizeUnconfirmed = !!raiseM[1];
    const raiseSize = parseFloat(raiseM[2]);
    let body = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (/^##\s+/.test(lines[j])) break;
      if (lines[j].trim().charAt(0) === '#') continue;
      body += (body ? ' ' : '') + lines[j].trim();
    }
    const hands = {};
    const seen = {};
    const tokens = body.split(/[,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    let scaled = 0;
    for (let t = 0; t < tokens.length; t++) {
      const parsed = parseToken(tokens[t]);
      if (!parsed) {
        warnings.push(filename + ' ' + hero + ': could not read "' + tokens[t] + '"');
        continue;
      }
      if (seen[parsed.hand]) warnings.push(filename + ' ' + hero + ': duplicate ' + parsed.hand);
      seen[parsed.hand] = 1;
      const made = makeCell(parsed.raise, parsed.limp);
      if (made.scaled) {
        scaled++;
        warnings.push(filename + ' ' + hero + ': ' + parsed.hand + ' raise+limp exceeded 100% and was scaled');
      }
      hands[parsed.hand] = made.cell;
    }
    const listed = Object.keys(hands).length;
    spots.push({
      hero: hero,
      depth: depth,
      raiseSize: raiseSize,
      sizeUnconfirmed: sizeUnconfirmed,
      headerPct: {
        fold: parseFloat(foldM[1]),
        raise: parseFloat(raiseM[3]),
        limp: callM ? parseFloat(callM[1]) : 0
      },
      hands: hands,
      listed: listed,
      scaled: scaled
    });
  }
  if (!spots.length) throw new Error(filename + ': no position sections');
  return { filename: filename, depth: depth, spots: spots, warnings: warnings };
}

function fillClasses(partial, classes) {
  const hands = {};
  for (let i = 0; i < classes.length; i++) {
    hands[classes[i]] = partial[classes[i]] ? partial[classes[i]] : { fold: 1 };
  }
  return hands;
}

function comboTotals(hands, classes) {
  const acc = { fold: 0, raise: 0, limp: 0, combos: 0 };
  for (let i = 0; i < classes.length; i++) {
    const n = classCount(classes[i]);
    const cell = hands[classes[i]] || { fold: 1 };
    acc.combos += n;
    acc.fold += (cell.fold || 0) * n;
    acc.raise += (cell.raise || 0) * n;
    acc.limp += (cell.limp || 0) * n;
  }
  return {
    combos: acc.combos,
    fold: acc.fold / acc.combos,
    raise: acc.raise / acc.combos,
    limp: acc.limp / acc.combos
  };
}

function toSpot(parsed, classes) {
  const hands = fillClasses(parsed.hands, classes);
  const hasLimp = parsed.headerPct.limp > 0 || Object.keys(hands).some(function (h) { return hands[h].limp > 0; });
  const actions = hasLimp ? ['raise', 'limp', 'fold'] : ['raise', 'fold'];
  const size = trimSize(parsed.raiseSize);
  const labels = { raise: 'Raise ' + size + 'bb', fold: 'Fold' };
  const sizes = { raise: parsed.raiseSize };
  if (hasLimp) {
    labels.limp = 'Limp';
    sizes.limp = 1;
  }
  const totals = comboTotals(hands, classes);
  const id = 'cash|6|' + parsed.depth + '|rfi:' + parsed.hero;
  let note = LABEL + ', ' + parsed.depth + 'bb ' + parsed.hero + ' first-in. Read from the matrix, not downloaded.';
  if (parsed.sizeUnconfirmed) note += ' Raise size was not confirmed on the matrix; assumed ' + size + 'bb.';
  return {
    id: id,
    source: 'reference',
    model: 'gtowizard-nl50-general',
    game: 'cash',
    tableSize: 6,
    stackBb: parsed.depth,
    rake: 'NL50',
    pool: 'General',
    hero: parsed.hero,
    villain: null,
    kind: 'rfi',
    actions: actions,
    labels: labels,
    sizes: sizes,
    sizeUnconfirmed: parsed.sizeUnconfirmed || false,
    headerPct: parsed.headerPct,
    note: note,
    hands: hands,
    totals: {
      fold: round4(totals.fold),
      raise: round4(totals.raise),
      limp: round4(totals.limp),
      combos: totals.combos
    }
  };
}

function buildDatabase(classes, rawDir) {
  const dir = rawDir || RAW_DIR;
  const warnings = [];
  const spots = [];
  const reports = [];
  for (let f = 0; f < RAW_FILES.length; f++) {
    const name = RAW_FILES[f];
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const parsed = parseFile(text, name);
    warnings.push.apply(warnings, parsed.warnings);
    for (let s = 0; s < parsed.spots.length; s++) {
      const spot = toSpot(parsed.spots[s], classes);
      spots.push(spot);
      reports.push(reportRow(spot));
    }
  }
  spots.sort(function (a, b) {
    if (a.stackBb !== b.stackBb) return b.stackBb - a.stackBb;
    return a.id < b.id ? -1 : 1;
  });
  return {
    format: 'holdem-lab.spots',
    version: 1,
    model: {
      id: 'gtowizard-nl50-general',
      label: LABEL,
      game: 'cash',
      table: '6-max',
      rake: 'NL50',
      pool: 'General',
      depths: [100, 75, 50],
      note: 'Hand-read first-in charts from GTO Wizard (6-max cash, NL50 rake, General). This app does not download them. C in an SB line is a limp. The 75bb SB raise size was not confirmed and is stored as 3bb.'
    },
    spots: spots,
    warnings: warnings,
    reports: reports
  };
}

function reportRow(spot) {
  const h = spot.headerPct;
  const pct = function (frac) { return Math.round(frac * 1000) / 10; };
  const rows = [
    { action: 'fold', got: pct(spot.totals.fold), want: h.fold },
    { action: 'raise', got: pct(spot.totals.raise), want: h.raise }
  ];
  if (h.limp) rows.push({ action: 'limp', got: pct(spot.totals.limp), want: h.limp });
  let worst = 0;
  rows.forEach(function (r) { worst = Math.max(worst, Math.abs(r.got - r.want)); });
  return { id: spot.id, rows: rows, worst: Math.round(worst * 1000) / 1000, ok: worst <= 1 };
}

function writeDatabase(db) {
  const shipped = {
    format: db.format,
    version: db.version,
    model: db.model,
    spots: db.spots
  };
  fs.writeFileSync(JSON_PATH, JSON.stringify(shipped));
  fs.writeFileSync(JS_PATH, 'window.HOLDEM_REFERENCE = ' + JSON.stringify(shipped) + ';\n');
  return { json: JSON_PATH, js: JS_PATH };
}

function main() {
  const { loadCore } = require('../solver/loadcore');
  const db = buildDatabase(loadCore().CLASSES);
  writeDatabase(db);
  db.reports.forEach(function (r) {
    const bits = r.rows.map(function (row) {
      return row.action + ' ' + row.got.toFixed(1) + ' vs ' + row.want.toFixed(1);
    }).join(', ');
    console.log((r.ok ? 'ok ' : 'MISMATCH ') + r.id + '  ' + bits + '  (off by ' + r.worst.toFixed(2) + ' pp)');
  });
  if (db.warnings.length) console.log('warnings:\n' + db.warnings.join('\n'));
  const bad = db.reports.filter(function (r) { return !r.ok; });
  console.log('wrote ' + db.spots.length + ' spots' + (bad.length ? ', ' + bad.length + ' outside 1pp' : ''));
  if (bad.length) process.exitCode = 1;
}

module.exports = {
  LABEL: LABEL,
  RAW_FILES: RAW_FILES,
  parseFile: parseFile,
  buildDatabase: buildDatabase,
  comboTotals: comboTotals,
  classCount: classCount,
  reportRow: reportRow,
  writeDatabase: writeDatabase,
  JSON_PATH: JSON_PATH,
  JS_PATH: JS_PATH
};

if (require.main === module) main();
