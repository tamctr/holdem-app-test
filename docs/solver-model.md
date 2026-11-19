# Preflop model (cash, 6-max, 100bb)

`solver/solve.js` builds the charts labelled **Solved (our model)**.
It is an equilibrium of the game below. It is not a GTO Wizard solve, and the
numbers are not copied from one.

## Game

- 6-max, 100bb effective, blinds 0.5 / 1, no ante, no limps.
- Open 2.5bb. The small blind opens to 3bb.
- A 3-bet is 3× the open in position and 4× from a blind, rounded to 0.25bb.
- A 4-bet is 2.5× the 3-bet. The next raise is all-in.
- Every node is fold, call, or that single larger size.

## Cards

169 hand classes share a strategy. Deals use real combos, so a hand that
blocks another hand is removed. Showdown equity is a class-pair table
(1,600 Monte Carlo boards per pair), not suit-specific.
Two or more opponents: a player's raw share is the product of their pairwise
equities, renormalised. That is an approximation, not an exact multiway count.

## After the flop

There is no postflop tree. If the pot is all-in preflop, or the pot is won
without a flop, players are paid their raw equity (or the whole pot) and
**no rake** is taken.

If two or more players see a flop with chips behind:

- Rake is 5% of the pot at the flop, capped at 3bb. Real rake is often higher,
  because the pot still grows postflop.
- The pot is split by raw equity times a position factor, then renormalised
  so the shares sum to 1.
  - Last to act postflop: 1.00
  - Out of position, heads-up: 0.85
  - Out of position, multiway: 0.78
- Postflop order is SB, BB, UTG, HJ, CO, BTN.
- There is no extra bonus for nut advantage, implied odds, or domination.
  That is why suited connectors and small pairs open less often here than in
  a solver that actually plays the flop, and why offsuit broadway can outrank them.

## Algorithm

External-sampling Monte Carlo CFR. Negative regrets are floored at 0
(regret-matching+). The stored strategy is the linear average of the second
half of the run (the first 45% is warmup and is not averaged).
Six players do not have the two-player Nash guarantee. The reported
exploitability is each seat's best response, trained against the other five
frozen, minus the solved strategy. See the `metrics` object in
`data/cash-spots.json`.

## Heads-up push/fold

`solver/pushfold.js` solves jam-or-fold for the small blind and call-or-fold
for the big blind at 8, 10 and 12bb. Chip EV, no rake, no ante, class-level
CFR+ with the same equity table and exact card-removal weights. Those spots
are in the database (`cash|2|10|rfi:BTN` and `cash|2|10|vs:BB:BTN`). The chart
screen starts at 50bb, so they are not a separate slider stop.

## Closed forms

`solver/math.js`:

- Required equity to call a bet B into pot P: `B / (P + 2B)`
- Minimum defence frequency: `P / (P + B)`
- Alpha, the fold frequency a pure bluff needs: `B / (P + B)`
- Bluff share of a polarised betting range: `B / (P + 2B)`
- Heads-up big blind versus an all-in of stack S: `(S - 1) / (2S)`

## Reproduce

```
node solver/equity.js 1600
node solver/solve.js --iters 2000 --ex 150
node test/solver.test.js
```
