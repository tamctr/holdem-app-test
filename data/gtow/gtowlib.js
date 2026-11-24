/* Decode the compact GTO Wizard bundle in data/gtow/app/ and describe a spot
   the way the Charts tab draws it. Frequencies in the files are percents
   (0–100). Charts handed to the app are 0–1, with the same action names the
   grid already paints. Works in the browser (window.GtoLib) and in node. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GtoLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RANKS = 'AKQJT98765432';
  var ACTS = [
    ['F', 'fold'], ['C', 'call'], ['R', 'raise'], ['S', 'raise2'], ['T', 'raise3'], ['A', 'allin']
  ];
  var ACT_NAME = {};
  for (var i = 0; i < ACTS.length; i++) ACT_NAME[ACTS[i][0]] = ACTS[i][1];
  var POS = ['UTG', 'UTG1', 'UTG2', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  var TOK = /^([2-9TJQKA]{2}[so]?)(?:@(\d+(?:\.\d+)?))?:([A-Z0-9./]+)$/;
  var PART = /^([FCRSTA])(\d+(?:\.\d+)?)?$/;

  function allHands() {
    var out = [];
    for (var i = 0; i < 13; i++) for (var j = 0; j < 13; j++) {
      if (i === j) out.push(RANKS[i] + RANKS[i]);
      else if (i < j) out.push(RANKS[i] + RANKS[j] + 's');
      else out.push(RANKS[j] + RANKS[i] + 'o');
    }
    return out;
  }
  var HANDS = allHands();

  function combos(hand) { return hand.length === 2 ? 6 : hand[2] === 's' ? 4 : 12; }
  function posRank(p) { var i = POS.indexOf(p); return i < 0 ? 99 : i; }
  function trimSize(n) {
    if (n == null || n === '') return '';
    var x = Number(n);
    if (!isFinite(x)) return String(n);
    if (Math.abs(x - Math.round(x)) < 1e-6) return String(Math.round(x));
    return String(Math.round(x * 100) / 100);
  }
  function emptyActs() { return { fold: 0, call: 0, raise: 0, raise2: 0, raise3: 0, allin: 0 }; }

  function decodeBody(body) {
    var out = emptyActs();
    if (!body) return out;
    var parts = body.split('/');
    var bare = null;
    for (var i = 0; i < parts.length; i++) {
      var m = PART.exec(parts[i]);
      if (!m) continue;
      var name = ACT_NAME[m[1]];
      if (m[2] == null) { bare = name; out[name] = 100; }
      else out[name] = parseFloat(m[2]);
    }
    if (bare && parts.length > 1) {
      var rest = 0;
      for (var k in out) if (k !== bare) rest += out[k];
      out[bare] = Math.max(0, 100 - rest);
    } else {
      var sum = out.fold + out.call + out.raise + out.raise2 + out.raise3 + out.allin;
      if (sum < 99.5 && !out.fold) out.fold = 100 - sum;
    }
    return out;
  }

  function parseId(id) {
    var p = String(id || '').split('|');
    if ((p[0] !== 'cash' && p[0] !== 'mtt') || p.length < 4) return null;
    var players = parseInt(p[1], 10);
    var depth = parseInt(p[2], 10);
    var rest = p.slice(3);
    var variant = null;
    if (rest[0] === 'complex' || rest[0] === 'simple') { variant = rest[0]; rest = rest.slice(1); }
    var tail = (rest[0] || '').split(':');
    return {
      id: id,
      game: p[0],
      players: players,
      depth: depth,
      variant: variant,
      kind: tail[0] || '',
      hero: tail[1] || '',
      villain: tail[2] || null,
      node: tail.slice(3).join(':')
    };
  }

  function laterKind(kind) { return kind === 'v3' || kind === 'v4' || kind === 'vl'; }

  function decode(packed, meta) {
    var id = parseId(packed.id);
    if (!id) throw new Error('bad spot id ' + packed.id);
    meta = meta || {};
    var hands = {};
    if (packed.x) {
      var toks = packed.x.split(',');
      for (var i = 0; i < toks.length; i++) {
        var m = TOK.exec(toks[i]);
        if (!m) continue;
        var cell = decodeBody(m[3]);
        cell.weight = m[2] != null ? parseFloat(m[2]) : 100;
        hands[m[1]] = cell;
      }
    }
    var later = laterKind(id.kind);
    for (var h = 0; h < HANDS.length; h++) {
      if (hands[HANDS[h]]) continue;
      var blank = emptyActs();
      blank.weight = later ? 0 : 100;
      if (!later) blank.fold = 100;
      hands[HANDS[h]] = blank;
    }
    var sizes = {};
    var sz = packed.sz || {};
    if (sz.R) sizes.raise = sz.R;
    if (sz.S) sizes.raise2 = sz.S;
    if (sz.T) sizes.raise3 = sz.T;
    if (sz.A) sizes.allin = sz.A;
    var ovIn = packed.ov || {};
    var overall = {
      fold: ovIn.F || 0, call: ovIn.C || 0, raise: ovIn.R || 0,
      raise2: ovIn.S || 0, raise3: ovIn.T || 0, allin: ovIn.A || 0
    };
    return {
      id: packed.id,
      game: id.game,
      gametype: meta.gametype || meta.file && String(meta.file).replace(/\.json$/, '') || '',
      players: id.players,
      depth: id.depth,
      variant: id.variant || meta.variant || null,
      kind: id.kind,
      hero: id.hero,
      villain: id.villain,
      node: id.node,
      later: later,
      sizes: sizes,
      overall: overall,
      precision: packed.p || null,
      sizeUnconfirmed: !!packed.su,
      rescale: packed.w || null,
      rake: meta.rake || null,
      pool: meta.pool || null,
      opening: meta.opening || null,
      coldCalls: !!meta.coldCalls,
      postflop: meta.postflop || null,
      label: meta.label || '',
      hands: hands
    };
  }

  function round4(x) { return Math.round(x * 10000) / 10000; }

  /* App chart: action -> frequency 0–1. SB first-in "call" is a limp. */
  function chartFromSpot(spot) {
    var limp = spot.kind === 'rfi';
    var chart = {};
    for (var i = 0; i < HANDS.length; i++) {
      var k = HANDS[i];
      var h = spot.hands[k];
      if (!h || (spot.later && h.weight <= 0.05)) { chart[k] = { fold: 1 }; continue; }
      var cell = {};
      var map = [
        ['allin', 'jam'], ['raise3', 'raise3'], ['raise2', 'raise2'], ['raise', 'raise'],
        ['call', limp ? 'limp' : 'call'], ['fold', 'fold']
      ];
      var tot = 0;
      for (var a = 0; a < map.length; a++) {
        var v = (h[map[a][0]] || 0) / 100;
        if (v > 0.0005) { cell[map[a][1]] = v; tot += v; }
      }
      if (tot <= 0) { chart[k] = { fold: 1 }; continue; }
      if (tot > 1.0001) { for (var key in cell) cell[key] = cell[key] / tot; }
      else if (tot < 0.999) cell.fold = (cell.fold || 0) + (1 - tot);
      for (var key2 in cell) cell[key2] = round4(cell[key2]);
      var drift = 1;
      var keys = Object.keys(cell);
      for (var d = 0; d < keys.length; d++) drift -= cell[keys[d]];
      drift = round4(drift);
      if (drift) {
        var fix = cell.fold != null ? 'fold' : keys[0];
        cell[fix] = round4((cell[fix] || 0) + drift);
      }
      chart[k] = cell;
    }
    return chart;
  }

  function verb(spot) {
    if (spot.kind === 'v3') return '4-Bet';
    if (spot.kind === 'v4') return '5-Bet';
    if (spot.kind === 'vs' && spot.node !== 'limp') return '3-Bet';
    return 'Raise';
  }

  function sized(word, n) {
    return n != null && n !== '' ? word + ' ' + trimSize(n) + 'bb' : word;
  }

  function actionsFor(spot) {
    var order = ['jam', 'raise3', 'raise2', 'raise', 'limp', 'call', 'fold'];
    var present = { fold: 1 };
    var ov = spot.overall || {};
    if (ov.allin > 0.05 || spot.sizes.allin) present.jam = 1;
    if (ov.raise3 > 0.05 || spot.sizes.raise3) present.raise3 = 1;
    if (ov.raise2 > 0.05 || spot.sizes.raise2) present.raise2 = 1;
    if (ov.raise > 0.05 || spot.sizes.raise) present.raise = 1;
    if (spot.kind === 'rfi' && ov.call > 0.05) present.limp = 1;
    else if (ov.call > 0.05) present.call = 1;
    // A size can be listed with a 0% header (the child of a split). Keep it
    // when the matrix actually uses it.
    if (!present.raise && !present.raise2 && !present.raise3 && !present.jam && !present.limp && !present.call) present.raise = 1;
    var out = [];
    for (var i = 0; i < order.length; i++) if (present[order[i]]) out.push(order[i]);
    return out;
  }

  function labelsFor(spot) {
    var v = verb(spot);
    var sz = spot.sizes || {};
    var labels = {
      raise: sized(v, sz.raise),
      raise2: sized(v, sz.raise2),
      raise3: sized(v, sz.raise3),
      jam: 'All-in',
      call: (spot.kind === 'vs' && spot.node === 'limp' && spot.hero === 'BB') ? 'Check' : 'Call',
      limp: 'Limp',
      fold: 'Fold'
    };
    if (spot.sizeUnconfirmed && sz.raise != null) labels.raise = v + ' ~' + trimSize(sz.raise) + 'bb';
    return labels;
  }

  function nodeLabel(node) {
    if (!node) return 'Main';
    if (node === 'limp') return 'Limp';
    if (node === 'allin' || node === 'AI') return 'All-in';
    if (node === 'raise_AI') return 'Open shove';
    var raiseOnly = /^raise_R(\d+(?:\.\d+)?)$/.exec(node);
    if (raiseOnly) return 'Raise ' + raiseOnly[1] + 'bb';
    return node.split(':').map(function (part) {
      if (part === 'AI' || part === 'A' || part === 'allin') return 'all-in';
      var r = /^R(\d+(?:\.\d+)?)$/.exec(part);
      if (r) return r[1] + 'bb';
      return part;
    }).join(' · ');
  }

  function nodeRank(node) {
    if (!node) return [0, 0];
    var r = /^R(\d+(?:\.\d+)?)/.exec(node);
    if (r) return [1, parseFloat(r[1])];
    if (node === 'limp') return [2, 0];
    if (hasAllin(node)) return [3, 0];
    return [4, 0];
  }

  function matchType(spot, type) {
    if (type === 'vl') return spot.kind === 'vl' || (spot.kind === 'vs' && spot.node === 'limp');
    if (type === 'vs') return spot.kind === 'vs' && spot.node !== 'limp';
    return spot.kind === type;
  }

  function tableName(n) {
    if (n === 2) return 'Heads-up';
    if (n === 6) return '6-max';
    if (n === 8) return '8-max';
    if (n === 9) return '9-max';
    return n + '-max';
  }

  function hasAllin(node) {
    return String(node || '').split(/[:_]/).some(function (part) {
      return part === 'AI' || part === 'A' || part.toLowerCase() === 'allin';
    });
  }

  function title(spot) {
    if (spot.kind === 'rfi') return spot.hero + ' open';
    if (spot.kind === 'vs' && spot.node === 'limp') return spot.hero + ' vs ' + spot.villain + ' limp';
    if (spot.kind === 'vs' && hasAllin(spot.node)) return spot.hero + ' vs ' + spot.villain + ' all-in';
    if (spot.kind === 'vs' && /^raise_R/.test(spot.node || '')) return spot.hero + ' vs ' + spot.villain + ' ' + nodeLabel(spot.node).toLowerCase();
    if (spot.kind === 'vs') return spot.hero + ' vs ' + spot.villain + ' open';
    if (spot.kind === 'v3') return spot.hero + ' vs ' + spot.villain + ' 3-bet';
    if (spot.kind === 'v4') return spot.hero + ' vs ' + spot.villain + ' 4-bet';
    if (spot.kind === 'vl') return spot.hero + ' vs ' + spot.villain + ' limp-raise';
    return spot.hero;
  }

  function desc(spot) {
    var sz = spot.sizes || {};
    var open = sz.raise != null ? trimSize(sz.raise) : '';
    var text;
    if (spot.kind === 'rfi' && spot.hero === 'SB') {
      text = 'Folded to you in the SB. Raise to ' + (spot.sizeUnconfirmed ? '~' : '') + (open || '?') + 'bb' +
        (spot.overall.allin > 0.05 ? ', shove,' : '') +
        (spot.overall.call > 0.05 ? ', limp, or fold?' : ' or fold?');
    } else if (spot.kind === 'rfi') {
      text = 'Folded to you in the ' + spot.hero + '. Open to ' + (open || '?') + 'bb or fold?';
    } else if (spot.kind === 'vs' && spot.node === 'limp') {
      text = spot.villain + ' limps, you are in the ' + spot.hero + '.';
    } else if (spot.kind === 'vs' && hasAllin(spot.node)) {
      text = spot.villain + ' open-shoves, you are in the ' + spot.hero + '.';
    } else if (spot.kind === 'vs' && /^raise_R/.test(spot.node || '')) {
      text = spot.villain + ' raises to ' + nodeLabel(spot.node).replace(/^Raise /, '') + ', you are in the ' + spot.hero + '. This is the raise, not the all-in shove.';
    } else if (spot.kind === 'vs') {
      text = spot.villain + ' opens, you are in the ' + spot.hero + '.';
    } else if (spot.kind === 'v3') {
      text = 'You opened from ' + spot.hero + ', ' + spot.villain + ' 3-bet, everyone else folded.';
    } else if (spot.kind === 'v4') {
      text = 'You 3-bet from ' + spot.hero + ' and ' + spot.villain + ' 4-bet.';
    } else if (spot.kind === 'vl') {
      text = 'You limped from the SB and ' + spot.villain + ' raised' + (spot.node ? ' (' + nodeLabel(spot.node) + ')' : '') + '.';
    } else text = title(spot);
    if (spot.node && spot.kind !== 'vl' && spot.node !== 'limp') text += ' Line: ' + nodeLabel(spot.node) + '.';
    return text;
  }

  function isMtt(spot) {
    return !!(spot && (spot.game === 'mtt' || String(spot.id || '').indexOf('mtt|') === 0 || String(spot.gametype || '').indexOf('MTT') === 0));
  }

  function sourceLabel(spot) {
    if (!spot) return 'GTO Wizard reference';
    if (isMtt(spot)) return 'GTO Wizard reference (MTT 8-max ChipEV, BB ante)';
    var gt = spot.gametype || '';
    if (gt === 'Cash6m50zGeneral' || (spot.players === 6 && spot.rake === 'NL50')) return 'GTO Wizard reference (NL50, General)';
    if (spot.players === 9) return 'GTO Wizard reference (9-max NL50)';
    if (spot.players === 2) return 'GTO Wizard reference (HU NL500 ' + (String(spot.variant || '').toLowerCase() === 'simple' ? 'Simple' : 'Complex') + ')';
    if (spot.players === 8) {
      var bits = ['8-max'];
      if (spot.rake === 'cEV') bits.push('cEV');
      else if (spot.rake === 'LIVE') bits.push('Live');
      if (spot.opening) bits.push(String(spot.opening).replace(/x$/, '') + 'x');
      if (spot.coldCalls) bits.push('cold calls');
      if (spot.pool === 'Simple') bits.push('Simple');
      return 'GTO Wizard reference (' + bits.join(', ') + ')';
    }
    return 'GTO Wizard reference';
  }

  function caveat(spot) {
    if (!spot) return '';
    if (isMtt(spot)) return 'ChipEV only (no ICM), 1bb BB ante (pot starts 2.5bb). Partial coverage.';
    var lines = [];
    if (spot.rescale) {
      lines.push('Limp-raise weights were rescaled ×' + spot.rescale + ' so the totals match GTO Wizard\'s overview.');
    }
    if (spot.sizeUnconfirmed) {
      lines.push('Raise size was not on the matrix; shown as ' + trimSize(spot.sizes && spot.sizes.raise) + 'bb.');
    }
    if (spot.players === 9) {
      lines.push('9-max branches under 0.5% were skipped, so a rare raise size may be missing.');
    }
    if (spot.id === 'cash|2|60|complex|v4:BB:SB:R9.5:R19') {
      lines.push('This 19bb 4-bet is 0% in the parent node; the chart was still extracted.');
    }
    if (spot.players === 6 && (spot.depth === 150 || spot.depth === 200)) {
      lines.push('No small-blind limp at this depth.');
    }
    return lines.join(' ');
  }

  function scenario(spot) {
    var mtt = isMtt(spot);
    var players = spot.players === 2 ? 'Heads-up' : spot.players + ' players';
    var table = mtt ? '8-max' : tableName(spot.players);
    return {
      id: spot.id,
      g: mtt ? 'mtt' : 'cash',
      icm: false,
      game: mtt ? 'MTT' : 'Cash',
      n: spot.players,
      stack: spot.depth,
      stackLabel: spot.depth + 'bb',
      type: spot.kind,
      hero: spot.hero,
      villain: spot.villain,
      heroLabel: spot.hero,
      villainLabel: spot.villain,
      rfi: spot.kind === 'rfi',
      group: 'GTO Wizard',
      name: title(spot),
      table: table,
      players: players,
      short: (mtt ? 'MTT' : 'Cash') + ' · ' + table + ' · ' + spot.depth + 'bb',
      headline: (mtt ? 'MTT' : 'Cash') + ' · ' + players + ' · ' + spot.depth + 'bb',
      desc: desc(spot),
      actions: actionsFor(spot),
      labels: labelsFor(spot)
    };
  }

  /* import, then the GTO Wizard reference, then a solved model, then heuristic. */
  function pickSource(hasImport, hasReference, hasSolved) {
    if (hasImport) return 'imported';
    if (hasReference) return 'reference';
    if (hasSolved) return 'solved';
    return 'heuristic';
  }

  function comboOverall(spot) {
    var acts = ['fold', 'call', 'raise', 'raise2', 'raise3', 'allin'];
    var tot = emptyActs();
    var reach = 0;
    for (var i = 0; i < HANDS.length; i++) {
      var h = spot.hands[HANDS[i]];
      var w = (h.weight || 0) / 100;
      if (spot.later && w <= 0) continue;
      var c = combos(HANDS[i]) * (spot.later ? w : 1);
      reach += c;
      for (var a = 0; a < acts.length; a++) tot[acts[a]] += c * ((h[acts[a]] || 0) / 100);
    }
    var pct = {};
    for (var b = 0; b < acts.length; b++) pct[acts[b]] = reach ? tot[acts[b]] / reach * 100 : 0;
    return { reach: reach, pct: pct };
  }

  return {
    HANDS: HANDS,
    POS: POS,
    parseId: parseId,
    decode: decode,
    chartFromSpot: chartFromSpot,
    actionsFor: actionsFor,
    labelsFor: labelsFor,
    nodeLabel: nodeLabel,
    nodeRank: nodeRank,
    matchType: matchType,
    posRank: posRank,
    title: title,
    desc: desc,
    sourceLabel: sourceLabel,
    caveat: caveat,
    scenario: scenario,
    pickSource: pickSource,
    comboOverall: comboOverall,
    combos: combos,
    trimSize: trimSize,
    tableName: tableName
  };
});
