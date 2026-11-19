'use strict';
/*
  Closed forms for bet sizing. All amounts are in the same chips (big blinds).

  Pot P is the pot BEFORE the bet. Villain bets B.
  - pot odds / required equity to call = B / (P + 2B)
  - minimum defence frequency (MDF) = P / (P + B)
      so a pure bluff does not profit if the defender continues at least this often
  - alpha = B / (P + B)
      how often a pure bluff must win immediately (the defender folds)
  - bluff share of a polarised betting range that makes a bluff-catcher indifferent
      = B / (P + 2B)
    value share = (P + B) / (P + 2B)
*/

function requiredEquity(toCall, potBeforeCall) {
  if (toCall <= 0) return 0;
  return toCall / (potBeforeCall + toCall);
}

function mdf(bet, pot) {
  if (bet <= 0) return 1;
  return pot / (pot + bet);
}

function alpha(bet, pot) {
  if (bet <= 0) return 0;
  return bet / (pot + bet);
}

function bluffShare(bet, pot) {
  if (bet <= 0) return 0;
  return bet / (pot + 2 * bet);
}

function valueShare(bet, pot) {
  return 1 - bluffShare(bet, pot);
}

/** Equity a caller needs against an all-in, given the pot before the call and the chips to call. */
function jamRequiredEquity(toCall, potBeforeCall) {
  return requiredEquity(toCall, potBeforeCall);
}

/**
 * Heads-up push/fold price for the big blind.
 * Effective stack S (total chips each player started with, in bb).
 * SB jammed S. BB already posted 1. BB calls S-1 into a pot of S+1.
 * Required equity = (S-1) / (2S).
 */
function huBbCallEquity(stackBb) {
  const S = stackBb;
  if (S <= 1) return 0;
  return (S - 1) / (2 * S);
}

/**
 * Minimum all-in calling range: every hand whose equity against `rangeWeights`
 * is at least the required equity.
 * rangeWeights: array of 169 non-negative combo weights (0 = not in the range).
 * eq: Float32/Float64 length 169*169, eq[i*169+j] = equity of i vs j.
 * live: optional same shape, fraction of combo pairs that do not conflict. Defaults to 1
 *       except a hand versus itself, which uses `selfLive` if provided.
 * Returns { required, hands: [{hand, equity, call}] }.
 */
function minAllInCallingRange(classes, rangeWeights, eq, opts) {
  const n = classes.length;
  const live = opts && opts.live;
  const required = opts && opts.required != null ? opts.required : 0.5;
  const hands = [];
  for (let i = 0; i < n; i++) {
    let num = 0, den = 0;
    for (let j = 0; j < n; j++) {
      const w = rangeWeights[j] || 0;
      if (w <= 0) continue;
      const lv = live ? live[i * n + j] : (i === j ? 0 : 1);
      if (lv <= 0) continue;
      const ww = w * lv;
      den += ww;
      num += ww * eq[i * n + j];
    }
    const e = den > 0 ? num / den : 0;
    hands.push({ hand: classes[i], equity: e, call: e >= required - 1e-12 });
  }
  return { required: required, hands: hands };
}

module.exports = {
  requiredEquity: requiredEquity,
  mdf: mdf,
  alpha: alpha,
  bluffShare: bluffShare,
  valueShare: valueShare,
  jamRequiredEquity: jamRequiredEquity,
  huBbCallEquity: huBbCallEquity,
  minAllInCallingRange: minAllInCallingRange
};
