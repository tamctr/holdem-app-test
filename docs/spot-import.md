# Cash spot database and import format

This is the format Hold'em Lab uses for a solved or pasted preflop strategy.
The app does not download anything from GTO Wizard. If you are looking at a spot
in GTO Wizard (or any other solver), export or copy the frequencies yourself and
paste them here. The chart is then labelled **Imported reference**.

A hand-read of the GTO Wizard cash preflop library ships in `data/gtow/`
(raw charts, `build.py`, and a compact bundle under `data/gtow/app/`). It
covers 6-max NL50 General, heads-up NL500 Complex and Simple, 9-max NL50,
and the 8-max live/cEV opening trees. The Charts tab loads one gametype at
a time. In GTO mode that reference replaces our model wherever a spot
exists. The small blind lines include a limp. Your own paste still replaces
it. The older 6-max first-in file `data/reference-gtow-cash.json` is the
same NL50 General opens at 50, 75 and 100bb and still regenerates with
`node tools/parse-gtow-rfi.js`.

## Where a chart comes from

The **GTO / Heuristic** switch at the top of Charts picks which family is drawn. The choice is saved in this browser and starts on **GTO**.

In GTO mode the chart for a spot is chosen in this order: your edits, then a paste (**Imported reference**), then the built-in **GTO Wizard reference** when this spot is in the library, then **Solved (our model)** when this spot was solved, then the heuristic.

| Label | Meaning |
| --- | --- |
| GTO Wizard reference (…) | GTO mode, when this spot is in the hand-read library. The exact label names the pool (NL50 General, 9-max, heads-up, or an 8-max rake and open). It replaces our model for that spot. |
| Solved (our model) | GTO mode, a 6-max 100bb line that was solved and is not in the library (the 5-bet jam). Not GTO Wizard. |
| Imported reference | GTO mode, when you have pasted this spot. It replaces the reference and the model for that spot only. Stored only in this browser. |
| Heuristic | Heuristic mode (the original pre-solver ranges), or GTO mode on a spot that has no reference, no solve and no import. The note under the switch says when that is a fallback. |

Lines that exist only in the solved set have no heuristic chart. Heuristic mode keeps showing the solved or imported chart for those and says so. The 75bb small-blind raise size was not on the matrix and is stored as 3bb. Some limp-raise nodes carry rescaled weights; the chart note says so.

Resetting a chart drops your edits of the family you are viewing. In GTO mode it also drops an imported reference for that spot.

## Spot id

```
cash|<players>|<stack bb>|<spot>
```

Examples:

- `cash|6|100|rfi:BTN` — button open, folded to you
- `cash|6|100|vs:BB:BTN` — big blind facing a button open, others folded
- `cash|6|100|v3:BTN:BB` — button opened, big blind 3-bet, folded back to the button
- `cash|6|100|v4:BB:BTN` — big blind 3-bet, button 4-bet
- `cash|6|100|vj:BTN:BB` — button 4-bet, big blind moved all-in

Action names the chart understands: `fold`, `call`, `raise`, `3bet`, `4bet`, `jam`, `limp`.
Aliases: `allin`, `all-in`, `5bet` and `shove` are `jam`. `open` and `bet` are `raise`.
A sized column such as `raise:2.5` is still the `raise` action; the size is only a label.

Frequencies are 0 to 1. A number above 1 is read as a percent (65 means 0.65).
Hands you leave out are 100% fold. If the frequencies for one hand sum to more
than 1, they are scaled down to 1.

## 1. Spot database JSON (version 1)

```json
{
  "format": "holdem-lab.spots",
  "version": 1,
  "spots": [
    {
      "id": "cash|6|100|rfi:BTN",
      "source": "imported",
      "game": "cash",
      "tableSize": 6,
      "stackBb": 100,
      "hero": "BTN",
      "actions": ["raise", "fold"],
      "hands": {
        "AA": { "raise": 1, "ev": 2.5 },
        "AKs": { "raise": 0.65, "fold": 0.35 },
        "76s": { "raise": 0.4, "fold": 0.6 }
      }
    }
  ]
}
```

`ev` is optional, in big blinds. One spot object, or an array of spots, is
accepted too. The solved file shipped with the app is `data/cash-spots.json`.
The built-in library is the compact bundle in `data/gtow/app/`. `data/reference-gtow-cash.json` is the older 6-max first-in extract.

## 2. CSV

```
# id: cash|6|100|vs:BB:BTN
# note: copied from the spot I was viewing
hand,fold,call,3bet,jam,ev
AA,0,0,0.2,0.8,11.2
AKs,0,0.25,0.75,0,
72o,1,0,0,0,
```

The `# id:` line is required. `ev` is optional.

## 3. Range block

One action at a time. A hand with no frequency is 100% of that action.
Hands never mentioned are folds. The same hand may appear under two actions.

```
# id: cash|6|100|rfi:CO
# source: imported
# hero: CO
# note: open-raise frequencies from the spot I was viewing
# action: raise
AA:1, KK:1, AKs:0.8, 76s:0.35, 22:0.5
```

Older chart exports from this app (`{"charts": {...}}`, including `rfi_btn`)
still import as edits, not as an imported reference.
