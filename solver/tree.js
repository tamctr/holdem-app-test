'use strict';
/*
  Public tree for the 6-max 100bb cash preflop model.
  No limps. One raise size at each level: open, 3-bet, 4-bet, then all-in.
  See docs/solver-model.md for the full list of assumptions.
*/

const SEATS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const N = 6;
const STACK = 100;
const RAKE_PCT = 0.05;
const RAKE_CAP = 3;
const PF_RANK = [2, 3, 4, 5, 0, 1]; // later postflop = more in position

const MODEL = {
  id: 'preflop-cfr-v1',
  game: 'cash',
  tableSize: 6,
  stackBb: 100,
  blindsBb: { sb: 0.5, bb: 1 },
  anteBb: 0,
  rake: {
    pct: RAKE_PCT,
    capBb: RAKE_CAP,
    preflopAllIn: 'none',
    uncontested: 'none',
    basis: 'When the hand sees a flop, rake is pct of the pot at the flop, capped. No-flop-no-drop otherwise. Postflop betting is not played out, so this is less rake than a full hand usually pays.'
  },
  betSizes: {
    openBb: 2.5,
    sbOpenBb: 3,
    threeBet: '3x the open in position, 4x from a blind, rounded to 0.25bb',
    fourBet: '2.5x the 3-bet, rounded to 0.25bb',
    fiveBet: 'all-in'
  },
  realisation: {
    summary: 'A flop pot is split by all-in class equity multiplied by a position factor, then renormalised so the shares sum to 1. All-in pots use raw equity and no rake.',
    inPosition: 1,
    outOfPositionHeadsUp: 0.85,
    outOfPositionMultiway: 0.78,
    postflopOrder: 'SB, BB, UTG, HJ, CO, BTN'
  },
  multiwayEquity: 'Three or more players: each player\'s raw share is the product of their pairwise equities against each opponent, renormalised. This is not an exact multiway enumeration.',
  handAbstraction: '169 classes. Combos of a class share a strategy. Deals remove blocked cards. Showdown equity is the class-pair table, not suit-specific.',
  algorithm: 'External-sampling Monte Carlo CFR, regret-matching+ (negative regrets floored at 0), linear average strategy. Six players, so the result is an approximate equilibrium of this model, not a proven Nash and not a full postflop solve.'
};

function roundQ(x) { return Math.round(x * 4) / 4; }
function openSize(seat) { return seat === 4 ? 3 : 2.5; }

function nextRaiseTo(state, seat) {
  if (state.raises === 0) return openSize(seat);
  if (state.raises === 1) return Math.min(STACK, roundQ(state.betTo * (seat >= 4 ? 4 : 3)));
  if (state.raises === 2) return Math.min(STACK, roundQ(state.betTo * 2.5));
  return STACK;
}

function nextLive(from, folded) {
  for (let k = 1; k <= N; k++) {
    const q = (from + k) % N;
    if (!folded[q]) return q;
  }
  return -1;
}

function liveOf(folded) {
  const live = [];
  for (let i = 0; i < N; i++) if (!folded[i]) live.push(i);
  return live;
}

function erfFor(live) {
  const erf = new Float64Array(N);
  if (!live.length) return erf;
  let ip = live[0], best = -1;
  for (let i = 0; i < live.length; i++) {
    const r = PF_RANK[live[i]];
    if (r > best) { best = r; ip = live[i]; }
  }
  const oop = live.length >= 3 ? MODEL.realisation.outOfPositionMultiway : MODEL.realisation.outOfPositionHeadsUp;
  for (let i = 0; i < live.length; i++) erf[live[i]] = live[i] === ip ? 1 : oop;
  return erf;
}

function legalActions(state) {
  if (state.raises === 0) return ['f', 'r'];
  if (state.betTo >= STACK - 1e-9 || state.raises >= 4) return ['f', 'c'];
  if (state.raises === 3) return ['f', 'c', 'j'];
  const nxt = nextRaiseTo(state, state.toAct);
  if (nxt >= STACK - 1e-9) return ['f', 'c', 'j'];
  return ['f', 'c', 'r'];
}

function initialState() {
  return {
    invested: [0, 0, 0, 0, 0.5, 1],
    folded: [0, 0, 0, 0, 0, 0],
    toAct: 0,
    betTo: 1,
    raises: 0,
    aggressor: -1,
    flats: 0,
    openSeat: -1,
    threeSeat: -1,
    history: ''
  };
}

function applyAction(state, action) {
  const p = state.toAct;
  const invested = state.invested.slice();
  const folded = state.folded.slice();
  let betTo = state.betTo;
  let raises = state.raises;
  let aggressor = state.aggressor;
  let flats = state.flats;
  let openSeat = state.openSeat;
  let threeSeat = state.threeSeat;
  if (action === 'f') folded[p] = 1;
  else if (action === 'c') {
    invested[p] = Math.min(STACK, betTo);
    flats += 1;
  } else {
    const size = action === 'j' ? STACK : nextRaiseTo(state, p);
    betTo = size;
    invested[p] = size;
    if (raises === 0) openSeat = p;
    else if (raises === 1) threeSeat = p;
    raises = action === 'j' ? 4 : raises + 1;
    aggressor = p;
    flats = 0;
  }
  return {
    invested: invested,
    folded: folded,
    toAct: nextLive(p, folded),
    betTo: betTo,
    raises: raises,
    aggressor: aggressor,
    flats: flats,
    openSeat: openSeat,
    threeSeat: threeSeat,
    history: state.history + '/' + SEATS[p] + ':' + action
  };
}

function terminalOf(state) {
  const live = liveOf(state.folded);
  if (live.length <= 1) return { kind: 'fold', winner: live.length ? live[0] : -1, live: live };
  if (state.raises > 0 && state.toAct === state.aggressor) {
    const allIn = state.betTo >= STACK - 1e-9;
    return { kind: allIn ? 'allin' : 'flop', winner: -1, live: live };
  }
  return null;
}

function cleanHeadsUp(state, a, b) {
  // Exactly players a and b are live, and nobody who folded put in more than a blind.
  // That is the single "folds to you" line, not a side path with dead calls.
  if (a < 0 || b < 0 || a === b) return false;
  for (let i = 0; i < N; i++) {
    if (i === a || i === b) {
      if (state.folded[i]) return false;
      continue;
    }
    if (!state.folded[i]) return false;
    const blind = i === 4 ? 0.5 : i === 5 ? 1 : 0;
    if (state.invested[i] > blind + 1e-6) return false;
  }
  return true;
}

function spotOf(state) {
  const hero = SEATS[state.toAct];
  if (hero == null) return null;
  if (state.raises === 0) return { kind: 'rfi', id: 'rfi:' + hero, hero: hero, villain: null };
  if (state.raises === 1 && state.flats === 0 && state.aggressor >= 0 && state.toAct !== state.aggressor) {
    return { kind: 'vs', id: 'vs:' + hero + ':' + SEATS[state.aggressor], hero: hero, villain: SEATS[state.aggressor] };
  }
  if (state.raises === 2 && state.flats === 0 && state.toAct === state.openSeat &&
      cleanHeadsUp(state, state.openSeat, state.threeSeat)) {
    return { kind: 'v3', id: 'v3:' + hero + ':' + SEATS[state.threeSeat], hero: hero, villain: SEATS[state.threeSeat] };
  }
  if (state.raises === 3 && state.flats === 0 && state.toAct === state.threeSeat && state.aggressor === state.openSeat &&
      cleanHeadsUp(state, state.openSeat, state.threeSeat)) {
    return { kind: 'v4', id: 'v4:' + hero + ':' + SEATS[state.openSeat], hero: hero, villain: SEATS[state.openSeat] };
  }
  if (state.raises >= 4 && state.betTo >= STACK - 1e-9 && state.toAct === state.openSeat && state.aggressor === state.threeSeat &&
      cleanHeadsUp(state, state.openSeat, state.threeSeat)) {
    return { kind: 'vj', id: 'vj:' + hero + ':' + SEATS[state.threeSeat], hero: hero, villain: SEATS[state.threeSeat] };
  }
  return null;
}

function chartAction(kind, raw) {
  if (raw === 'f') return 'fold';
  if (raw === 'c') return 'call';
  if (raw === 'j') return 'jam';
  if (kind === 'rfi') return 'raise';
  if (kind === 'vs') return '3bet';
  if (kind === 'v3') return '4bet';
  if (kind === 'v4') return 'jam';
  return 'raise';
}

function buildTree() {
  const nodes = [];
  const byHist = new Map();
  function rec(state) {
    const prev = byHist.get(state.history);
    if (prev != null) return prev;
    const id = nodes.length;
    const node = { id: id, history: state.history };
    nodes.push(node);
    byHist.set(state.history, id);
    const term = terminalOf(state);
    if (term) {
      let pot = 0;
      const invested = new Float64Array(N);
      for (let i = 0; i < N; i++) { invested[i] = state.invested[i]; pot += invested[i]; }
      node.term = true;
      node.kind = term.kind;
      node.winner = term.winner;
      node.pot = pot;
      node.invested = invested;
      node.live = Int8Array.from(term.live);
      node.realize = term.kind === 'flop';
      node.rake = node.realize ? Math.min(RAKE_CAP, pot * RAKE_PCT) : 0;
      node.erf = node.realize ? erfFor(term.live) : null;
      node.seat = -1;
      return id;
    }
    const acts = legalActions(state);
    const spot = spotOf(state);
    node.term = false;
    node.seat = state.toAct;
    node.nAct = acts.length;
    node.actions = acts;
    node.child = new Int32Array(acts.length);
    node.raises = state.raises;
    node.betTo = state.betTo;
    node.flats = state.flats;
    node.aggressor = state.aggressor;
    node.openSeat = state.openSeat;
    node.threeSeat = state.threeSeat;
    node.spot = spot;
    node.regret = new Float64Array(169 * acts.length);
    node.stratSum = new Float64Array(169 * acts.length);
    if (spot) {
      node.evSum = new Float64Array(169);
      node.evN = new Uint32Array(169);
    }
    for (let a = 0; a < acts.length; a++) node.child[a] = rec(applyAction(state, acts[a]));
    return id;
  }
  rec(initialState());
  return nodes;
}

function countSummary(nodes) {
  let decisions = 0, terminals = 0, tracked = 0;
  const kinds = {};
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.term) terminals++;
    else {
      decisions++;
      if (n.spot) {
        tracked++;
        kinds[n.spot.kind] = (kinds[n.spot.kind] || 0) + 1;
      }
    }
  }
  return { nodes: nodes.length, decisions: decisions, terminals: terminals, tracked: tracked, kinds: kinds };
}

module.exports = {
  SEATS: SEATS, N: N, STACK: STACK, MODEL: MODEL,
  legalActions: legalActions, buildTree: buildTree, countSummary: countSummary,
  chartAction: chartAction, spotOf: spotOf, initialState: initialState
};

if (require.main === module) {
  const t0 = Date.now();
  const nodes = buildTree();
  console.log(countSummary(nodes), 'ms', Date.now() - t0);
}
