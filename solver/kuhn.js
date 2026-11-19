'use strict';
/*
  Kuhn poker. Proves the CFR update (regret-matching+ and linear averaging) reaches
  the known equilibrium. Deck J, Q, K. Each player antes 1. Bet size is 1.
  Player 1 checks or bets. Facing a bet the opponent calls or folds.
  If player 1 checks, player 2 may check or bet, and player 1 may call or fold.
  Equilibrium value for player 1 is -1/18 per deal.
*/

function solveKuhn(iterations) {
  const regret = new Float64Array(12 * 2);
  const stratSum = new Float64Array(12 * 2);
  const buf = [0, 0];
  function id(spot, card) { return spot * 3 + card; }
  function strategy(spot, card) {
    const base = id(spot, card) * 2;
    let sum = 0;
    for (let a = 0; a < 2; a++) {
      const r = regret[base + a];
      buf[a] = r > 0 ? r : 0;
      sum += buf[a];
    }
    if (sum <= 0) { buf[0] = 0.5; buf[1] = 0.5; }
    else { buf[0] /= sum; buf[1] /= sum; }
    return buf;
  }
  function avg(spot, card) {
    const base = id(spot, card) * 2;
    const sum = stratSum[base] + stratSum[base + 1];
    if (sum <= 0) return [0.5, 0.5];
    return [stratSum[base] / sum, stratSum[base + 1] / sum];
  }
  // Utility for player 1. history is the list of actions (0 = passive, 1 = aggressive).
  function util(p1, p2, history) {
    const win = p1 > p2 ? 1 : -1;
    const a0 = history[0];
    if (a0 === 1) {
      if (history[1] === 0) return 1;
      return 2 * win;
    }
    if (history[1] === 0) return win;
    if (history[2] === 0) return -1;
    return 2 * win;
  }
  function nextSpot(spot, action) {
    if (spot === 0) return action === 1 ? 1 : 2;
    if (spot === 1) return -1;
    if (spot === 2) return action === 1 ? 3 : -1;
    return -1;
  }
  function playerOf(spot) { return (spot === 0 || spot === 3) ? 0 : 1; }

  function cfr(spot, history, p1, p2, reach0, reach1, t) {
    if (spot < 0) return util(p1, p2, history);
    const player = playerOf(spot);
    const card = player === 0 ? p1 : p2;
    const s = strategy(spot, card);
    const s0 = s[0], s1 = s[1];
    const base = id(spot, card) * 2;
    const evs = [0, 0];
    let ev = 0;
    for (let a = 0; a < 2; a++) {
      const prob = a === 0 ? s0 : s1;
      history.push(a);
      const r0 = player === 0 ? reach0 * prob : reach0;
      const r1 = player === 1 ? reach1 * prob : reach1;
      evs[a] = cfr(nextSpot(spot, a), history, p1, p2, r0, r1, t);
      history.pop();
      ev += prob * evs[a];
    }
    const cf = player === 0 ? reach1 : reach0;
    const pi = player === 0 ? reach0 : reach1;
    // util() is player 1's chips. Player 2 maximises the negative of that.
    const sign = player === 0 ? 1 : -1;
    regret[base] += cf * sign * (evs[0] - ev);
    regret[base + 1] += cf * sign * (evs[1] - ev);
    if (regret[base] < 0) regret[base] = 0;
    if (regret[base + 1] < 0) regret[base + 1] = 0;
    stratSum[base] += t * pi * s0;
    stratSum[base + 1] += t * pi * s1;
    return ev;
  }

  for (let t = 1; t <= iterations; t++) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== j) cfr(0, [], i, j, 1, 1, t);
  }

  // Infoset-level best response: one action per (spot, card), chosen before the
  // opponent's card is revealed. A per-deal max would cheat by seeing that card.
  function profileValue(brPlayer, brAct) {
    function rec(spot, history, p1, p2) {
      if (spot < 0) return util(p1, p2, history);
      const player = playerOf(spot);
      const card = player === 0 ? p1 : p2;
      if (player === brPlayer) {
        const a = brAct[spot][card];
        history.push(a);
        const u = rec(nextSpot(spot, a), history, p1, p2);
        history.pop();
        return u;
      }
      const s = avg(spot, card);
      let ev = 0;
      for (let a = 0; a < 2; a++) {
        history.push(a);
        ev += s[a] * rec(nextSpot(spot, a), history, p1, p2);
        history.pop();
      }
      return ev;
    }
    let v = 0, n = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== j) {
      v += rec(0, [], i, j);
      n++;
    }
    return v / n;
  }
  function bestResponse(brPlayer) {
    const brAct = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const order = brPlayer === 0 ? [3, 0] : [1, 2];
    for (let s = 0; s < order.length; s++) {
      const spot = order[s];
      for (let card = 0; card < 3; card++) {
        let bestA = 0, bestV = -Infinity;
        for (let a = 0; a < 2; a++) {
          brAct[spot][card] = a;
          const v = profileValue(brPlayer, brAct);
          const mine = brPlayer === 0 ? v : -v;
          if (mine > bestV) { bestV = mine; bestA = a; }
        }
        brAct[spot][card] = bestA;
      }
    }
    const v = profileValue(brPlayer, brAct);
    return brPlayer === 0 ? v : -v;
  }
  const value = profileValue(-1, null);
  const b0 = bestResponse(0);
  const b1 = bestResponse(1);
  const stratNames = ['check', 'bet'];
  function row(spot, names) {
    return [0, 1, 2].map(c => {
      const s = avg(spot, c);
      const o = { card: 'JQK'[c] };
      o[names[0]] = s[0];
      o[names[1]] = s[1];
      return o;
    });
  }
  return {
    iterations: iterations,
    value: value,
    exploitability: (b0 - value) + (b1 - (-value)),
    strategy: {
      p1: row(0, stratNames),
      p2faceBet: row(1, ['fold', 'call']),
      p2faceCheck: row(2, stratNames),
      p1faceBet: row(3, ['fold', 'call'])
    }
  };
}

module.exports = { solveKuhn: solveKuhn, VALUE: -1 / 18 };
