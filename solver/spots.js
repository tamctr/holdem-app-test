'use strict';
/*
  Spot database, version 1, and the text formats Tam can paste from a solver
  she is looking at (including a hand-built GTO Wizard export). This file does
  not contact GTO Wizard and does not contain its data.

  Browser: window.HoldemSpots. Node: module.exports.
*/

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HoldemSpots = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ACTIONS = ['fold', 'call', 'raise', '3bet', '4bet', 'jam', 'limp'];
  var ALIAS = {
    fold: 'fold', f: 'fold',
    call: 'call', c: 'call',
    raise: 'raise', r: 'raise', open: 'raise', bet: 'raise',
    '3bet': '3bet', '3-bet': '3bet', threebet: '3bet',
    '4bet': '4bet', '4-bet': '4bet', fourbet: '4bet',
    jam: 'jam', allin: 'jam', 'all-in': 'jam', '5bet': 'jam', '5-bet': 'jam', shove: 'jam',
    limp: 'limp', l: 'limp'
  };

  function round4(x) { return Math.round(x * 10000) / 10000; }

  function canonicalAction(name) {
    if (name == null) return null;
    var raw = String(name).trim().toLowerCase();
    var size = null;
    var m = raw.match(/^(raise|bet|open|3bet|3-bet|4bet|4-bet|jam|all-?in|5-?bet)\s*[:=]\s*(\d+(?:\.\d+)?)$/);
    if (m) { raw = m[1]; size = parseFloat(m[2]); }
    var a = ALIAS[raw];
    return a ? { action: a, size: size } : null;
  }

  function emptyHands(classes) {
    var hands = {};
    for (var i = 0; i < classes.length; i++) hands[classes[i]] = { fold: 1 };
    return hands;
  }

  function normaliseCell(cell) {
    var out = {}, tot = 0, ev = null;
    if (!cell || typeof cell !== 'object') return { fold: 1 };
    if (cell.ev != null && isFinite(+cell.ev)) ev = Math.round(+cell.ev * 1000) / 1000;
    for (var k in cell) {
      if (k === 'ev' || k === 'n') continue;
      var can = canonicalAction(k);
      if (!can) continue;
      var v = +cell[k];
      if (!isFinite(v) || v <= 0) continue;
      if (v > 1) v = v / 100; // accept 0-100 percentages
      out[can.action] = (out[can.action] || 0) + v;
      tot += v;
    }
    if (tot <= 0) return ev != null ? { fold: 1, ev: ev } : { fold: 1 };
    if (tot > 1.0001) {
      for (var a in out) out[a] = out[a] / tot;
      tot = 1;
    }
    var keys = Object.keys(out), s = 0;
    for (var i = 0; i < keys.length; i++) { out[keys[i]] = round4(out[keys[i]]); s += out[keys[i]]; }
    if (s < 0.999) out.fold = round4((out.fold || 0) + (1 - s));
    if (ev != null) out.ev = ev;
    return out;
  }

  function totalsOf(hands, counts) {
    var t = {}, combos = 0;
    for (var h in hands) {
      var n = counts ? counts[h] : 1;
      combos += n;
      var cell = hands[h];
      for (var a in cell) if (a !== 'ev') t[a] = (t[a] || 0) + cell[a] * n;
    }
    var out = { combos: combos };
    for (var a in t) out[a] = combos ? round4(t[a] / combos) : 0;
    return out;
  }

  function normaliseSpot(raw, classes, warnings) {
    if (!raw || typeof raw !== 'object') throw new Error('A spot must be an object');
    var id = raw.id ? String(raw.id) : '';
    if (!id) throw new Error('Each spot needs an id, for example cash|6|100|rfi:BTN');
    var handsIn = raw.hands || {};
    var hands = emptyHands(classes);
    var known = {};
    for (var i = 0; i < classes.length; i++) known[classes[i]] = 1;
    for (var h in handsIn) {
      if (!known[h]) {
        warnings.push(id + ': ignored unknown hand ' + h);
        continue;
      }
      hands[h] = normaliseCell(handsIn[h]);
    }
    var actions = [];
    var seen = {};
    ACTIONS.forEach(function (a) { seen[a] = 0; });
    for (var hk in hands) for (var a in hands[hk]) if (a !== 'ev' && seen[a] != null) seen[a] += hands[hk][a];
    ACTIONS.forEach(function (a) { if (seen[a] > 0) actions.push(a); });
    if (!actions.length) actions = ['fold'];
    if (actions.indexOf('fold') < 0) actions.push('fold');
    return {
      id: id,
      source: raw.source || 'imported',
      model: raw.model || null,
      game: raw.game || (id.indexOf('cash|') === 0 ? 'cash' : null),
      tableSize: raw.tableSize != null ? raw.tableSize : null,
      stackBb: raw.stackBb != null ? raw.stackBb : null,
      rake: raw.rake || null,
      positions: raw.positions || null,
      hero: raw.hero || null,
      villain: raw.villain || null,
      actionHistory: raw.actionHistory || null,
      kind: raw.kind || null,
      actions: raw.actions || actions,
      labels: raw.labels || null,
      sizes: raw.sizes || null,
      note: raw.note || null,
      hands: hands,
      totals: raw.totals || null
    };
  }

  function parseJson(obj, classes) {
    var warnings = [];
    if (obj && obj.charts && !obj.spots && !obj.format) {
      return { type: 'charts', charts: obj.charts, edited: obj.edited || null, warnings: warnings };
    }
    var list;
    if (obj && obj.format === 'holdem-lab.spots') {
      if (obj.version !== 1) throw new Error('Unsupported spot database version ' + obj.version + ' (this app reads version 1)');
      list = obj.spots || [];
    } else if (Array.isArray(obj)) list = obj;
    else if (obj && obj.spots) list = obj.spots;
    else if (obj && obj.id && obj.hands) list = [obj];
    else throw new Error('JSON is not a spot database. Expected {"format":"holdem-lab.spots","version":1,"spots":[...]} or a chart export.');
    var spots = list.map(function (s) { return normaliseSpot(s, classes, warnings); });
    return { type: 'spots', spots: spots, warnings: warnings, meta: obj && obj.model ? obj.model : null };
  }

  function parseCsv(text, classes, warnings) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() && l.trim().charAt(0) !== '#'; });
    if (!lines.length) throw new Error('CSV is empty');
    var header = splitCsv(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    var handCol = header.indexOf('hand');
    if (handCol < 0) throw new Error('CSV needs a hand column');
    var cols = [];
    for (var c = 0; c < header.length; c++) {
      if (c === handCol) continue;
      if (header[c] === 'ev') { cols.push({ ev: true, index: c }); continue; }
      var can = canonicalAction(header[c]);
      if (!can) { warnings.push('CSV: ignored column ' + header[c]); continue; }
      cols.push({ action: can.action, size: can.size, index: c });
    }
    if (!cols.some(function (c) { return c.action; })) throw new Error('CSV needs at least one action column (fold, call, raise, 3bet, 4bet, jam)');
    var hands = {};
    var known = {};
    for (var i = 0; i < classes.length; i++) known[classes[i]] = 1;
    for (var r = 1; r < lines.length; r++) {
      var cells = splitCsv(lines[r]);
      var hand = (cells[handCol] || '').trim();
      if (!hand) continue;
      if (!known[hand]) { warnings.push('CSV: unknown hand ' + hand); continue; }
      var cell = {};
      for (var k = 0; k < cols.length; k++) {
        var v = parseFloat(cells[cols[k].index]);
        if (!isFinite(v)) continue;
        if (cols[k].ev) cell.ev = v;
        else cell[cols[k].action] = v;
      }
      hands[hand] = cell;
    }
    return hands;
  }

  function splitCsv(line) {
    return line.split(',').map(function (s) { return s.trim(); });
  }

  function parseBlocks(text, classes, warnings) {
    var id = null, note = null, hero = null, villain = null, source = 'imported';
    var current = null;
    var buckets = {}; // action -> {hand: freq}
    var lines = text.split(/\r?\n/);
    function ensure(action) { if (!buckets[action]) buckets[action] = {}; return buckets[action]; }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.charAt(0) === '#') {
        var body = line.slice(1).trim();
        var kv = body.match(/^([a-zA-Z][\w-]*)\s*[:=]\s*(.*)$/);
        if (!kv) continue;
        var key = kv[1].toLowerCase(), val = kv[2].trim();
        if (key === 'id' || key === 'spot') id = val;
        else if (key === 'note') note = val;
        else if (key === 'hero') hero = val;
        else if (key === 'villain' || key === 'opener') villain = val;
        else if (key === 'source') source = val;
        else if (key === 'action') {
          var can = canonicalAction(val);
          if (!can) throw new Error('Unknown action "' + val + '"');
          current = can.action;
        }
        continue;
      }
      // range tokens: AA:1, KK:0.5, AKs
      var tokens = line.split(/[\s,]+/).filter(Boolean);
      for (var t = 0; t < tokens.length; t++) addToken(tokens[t], current, buckets, classes, warnings, ensure);
    }
    if (!id) throw new Error('Add a first line "# id: cash|6|100|rfi:BTN" (or whichever spot you are pasting)');
    var hands = {};
    for (var a in buckets) for (var h in buckets[a]) {
      if (!hands[h]) hands[h] = {};
      hands[h][a] = buckets[a][h];
    }
    return { id: id, source: source, hero: hero, villain: villain, note: note, hands: hands };
  }

  function addToken(token, current, buckets, classes, warnings, ensure) {
    var m = token.match(/^([2-9TJQKA]{2}[so]?)\s*[:=]\s*(\d+(?:\.\d+)?)$/i);
    var hand, freq;
    if (m) { hand = canonHand(m[1]); freq = parseFloat(m[2]); }
    else { hand = canonHand(token); freq = 1; }
    if (!hand) { warnings.push('Ignored token ' + token); return; }
    var ok = false;
    for (var i = 0; i < classes.length; i++) if (classes[i] === hand) ok = true;
    if (!ok) { warnings.push('Unknown hand ' + hand); return; }
    if (freq > 1) freq = freq / 100;
    var action = current || 'raise';
    ensure(action)[hand] = freq;
  }

  function canonHand(s) {
    s = String(s || '').trim();
    if (!s) return null;
    var pair = s.match(/^([2-9TJQKA])\1$/i);
    if (pair) return pair[1].toUpperCase() + pair[1].toUpperCase();
    var m = s.match(/^([2-9TJQKA])([2-9TJQKA])([so])$/i);
    if (!m) return null;
    var a = m[1].toUpperCase(), b = m[2].toUpperCase(), so = m[3].toLowerCase();
    var ranks = '23456789TJQKA';
    if (ranks.indexOf(a) < ranks.indexOf(b)) { var tmp = a; a = b; b = tmp; }
    return a + b + so;
  }

  function parseSpotImport(text, classes) {
    if (!classes || !classes.length) throw new Error('Hand classes are missing');
    var trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('Paste a spot file first');
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      var obj;
      try { obj = JSON.parse(trimmed); }
      catch (e) { throw new Error('JSON did not parse: ' + e.message); }
      return parseJson(obj, classes);
    }
    var warnings = [];
    var first = trimmed.split(/\r?\n/).filter(function (l) { return l.trim() && l.trim().charAt(0) !== '#'; })[0] || '';
    var looksCsv = /^hand\s*,/i.test(first) || (first.indexOf(',') >= 0 && /fold|call|raise|jam|all-?in/i.test(first) && first.indexOf(':') < 0);
    if (looksCsv) {
      var hands = parseCsv(trimmed, classes, warnings);
      var id = null, note = null;
      trimmed.split(/\r?\n/).forEach(function (l) {
        var m = l.trim().match(/^#\s*id\s*[:=]\s*(.*)$/i);
        if (m) id = m[1].trim();
        var n = l.trim().match(/^#\s*note\s*[:=]\s*(.*)$/i);
        if (n) note = n[1].trim();
      });
      if (!id) throw new Error('CSV needs a "# id: cash|6|100|rfi:BTN" line so the app knows which spot this is');
      var spot = normaliseSpot({ id: id, source: 'imported', note: note, hands: hands }, classes, warnings);
      return { type: 'spots', spots: [spot], warnings: warnings };
    }
    var block = parseBlocks(trimmed, classes, warnings);
    return { type: 'spots', spots: [normaliseSpot(block, classes, warnings)], warnings: warnings };
  }

  function validateDatabase(db, classes) {
    if (!db || db.format !== 'holdem-lab.spots') throw new Error('format must be holdem-lab.spots');
    if (db.version !== 1) throw new Error('version must be 1');
    if (!Array.isArray(db.spots) || !db.spots.length) throw new Error('spots must be a non-empty array');
    var ids = {};
    db.spots.forEach(function (s) {
      if (!s.id) throw new Error('spot missing id');
      if (ids[s.id]) throw new Error('duplicate spot ' + s.id);
      ids[s.id] = 1;
      if (!s.hands) throw new Error(s.id + ' missing hands');
      classes.forEach(function (h) {
        var cell = s.hands[h];
        if (!cell) throw new Error(s.id + ' missing ' + h);
        var tot = 0;
        for (var a in cell) if (a !== 'ev') {
          if (cell[a] < -1e-6 || cell[a] > 1 + 1e-6) throw new Error(s.id + ' ' + h + ' ' + a + ' out of range');
          tot += cell[a];
        }
        if (Math.abs(tot - 1) > 0.02) throw new Error(s.id + ' ' + h + ' frequencies sum to ' + tot);
      });
    });
    return true;
  }

  return {
    ACTIONS: ACTIONS,
    canonicalAction: canonicalAction,
    parseSpotImport: parseSpotImport,
    normaliseSpot: normaliseSpot,
    validateDatabase: validateDatabase,
    totalsOf: totalsOf,
    emptyHands: emptyHands
  };
});
