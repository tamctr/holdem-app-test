# MTT library (read 2026-11-23 ~19:58 Taipei, 3 min before Open Week end; partial)
- Solutions panels loaded (no daily-limit message at 19:57; page needed one reload after a blank splash).
- Library > MTT filters: Format = Heads-up / ChipEV / ICM / Events; Players = 3..9; Postflop = Single Size (NEW) / Multi Size; Stack type = Any/Symmetric/Near/Far/Big stack.
- ChipEV, 8 players, Single Size: 162 situations. Stacks listed per seat (avg + UTG..BB), e.g. symmetric 200,160,130,100,80,70,60,55,50,45,40,38,... ; many asymmetric stack sets.
- Example id: gametype=MTTGeneral_8m, depth=100.125 (symmetric 100bb avg), URL param stacks=100.125-...-100.125. Panel title "MTT Avg. 100bb ChipEV"; UTG opens Raise 2.1 16.9%.
- Not examined: 9max id, BB-ante flag, ICM/Events ids, other depths.

## Free-tier findings (2026-11-23 ~20:15, after Open Week)
- Free accounts: "Free accounts can browse 100 preflop spots per day. Upgrade for unlimited access." Counter shown top of matrix as n/100; each new preflop node view counts. ~83 used; limit not hit.
- Symmetric depth URL pattern: gametype=MTTGeneral_8m&depth=<X>.125&stacks=<X>.125 x8 (hyphen-joined). Verified 100, 40, 20.
- BB ante: yes - pot at start = 2.5 BB (SB 0.5 + BB 1 + ante 1 BB).
- Extracted at 100bb: RFI(7), 28 vsOpen (all pairs), 7 vs3bet (opener vs BB 3bet), 7 vs4bet (BB vs opener 4bet), vsOpen_BB_SB_limp, vsLimpRaise_SB_BB. 60bb, 40bb and 20bb: RFI(7) + BB vs each open (7). 60bb also has SB vs each open (6) and SB vs BB 3-bet. 50, 30, 25 and 15bb: RFI(7), BB vs each open (7), SB vs each open (6), SB vs BB 3-bet. 60bb opens: UTG 2, UTG1 2, LJ 2, HJ 2.1, CO 2.1, BTN 2.2, SB 3.5.
- At 15, 25 and 30bb the SB open includes an all-in shove and a raise. BB vs the raise stays `raise_R3` or `raise_R2.5`. BB vs the shove is a separate call/fold chart (`vs:BB:SB:allin`) at 15, 20, 25 and 30bb.
- 20bb and 40bb now have SB vs each open and SB vs a BB 3-bet, so 15–60bb all have RFI, BB vs open, SB vs open and SB vs BB 3-bet. BB vs an SB limp is present at 15–60bb (15bb has two raise sizes). Opener vs a BB 3-bet is present for UTG through BTN at those depths.
- vs3bet files that omitted pure folds are completed from the opener's RFI range: a hand that raised and is missing from the 3-bet list is a pure fold. Limps and shoves are not copied onto the 3-bet node.
