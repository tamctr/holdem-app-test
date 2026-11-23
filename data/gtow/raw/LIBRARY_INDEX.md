# GTO Wizard Solutions library: Hold'em Cash (discovery only, read 2026-11-23, Classic type, all other filters = Any)
Filters seen: Type (Classic/Short/Ante/Straddle/Straddle+Ante/DoubleStraddle/MississippiStraddle; only Classic examined), Players (Heads-up/6max/8max/9max), Postflop bet sizes (Single Size [NEW] / Multi Size), Stacks, Bet sizes (Simple/Simplified/General), Rake, Opening size, 3bet size, Hero (IP/OOP), Cash drop (6max single only).

## Multi Size (multi-size postflop trees)
- 6max: 58 situations. Bet-size types: General, Simple, Simplified (Simplified has Hero IP/OOP variants). Rakes: NL50, NL500, NL50 GG, NL1k GG. Opening: GTO or 2.5x; 3bet: GTO or Smaller.
  - General NL50 GTO/GTO: 200,150,100,75,50,40,20 (this is the Cash6m50zGeneral set used for the dumps). General NL50 at 100bb only: 2.5x open/GTO 3bet, 2.5x/Smaller, GTO/Smaller. General NL50 GG 100bb GTO/GTO. General NL500 100bb: 2.5x/Smaller, GTO/Smaller; General NL1k GG 100bb GTO/GTO.
  - Simple NL50 and NL500 GTO/GTO: 200,150,100,75,50,40,20; plus 100bb only 2.5x/GTO, 2.5x/Smaller, GTO/Smaller. Simplified NL50/NL500: 100bb only, IP and OOP hero variants, for 2.5x/Smaller, 2.5x/GTO, GTO/Smaller, GTO/GTO.
- Heads-up: 10 situations, stacks 500,400,300,200,150,100,80,60,40,20; types Simple/Advanced (no rake/open filters shown).
- 8max: no Multi Size option (single only).
- 9max: 6 situations, all 100bb NL50: General GTO/GTO, General 2.5x/GTO, Simple GTO/GTO, Simple 2.5x/GTO, Simple 2.5x/Smaller, Simple GTO/Smaller.

## Single Size (single-size postflop trees)
- 6max: 1469 situations. Preflop variants: No cold calls / With cold calls / Research. Rakes: cEV, NL10, NL25, NL50, NL100, NL200, NL500, NL1k, NL2k, NL5k, NL10k, GG R&C, NL50 GG, NL500 GG. Opening: GTO, 2x, 2.25x, 2.5x, 3x. Cash drop: None/10bb/20bb. Stacks seen: 300,200,150,125,100,90,80,70,60,50,40,30,20 (cEV/3x/GG rows seen with 20-300; some rows narrower, e.g. cEV 2.5x with cold calls 20-80).
- Heads-up: 512 situations. Variants: With limps / No limps; type General (and Research); Rakes cEV, NL25, NL100, NL200, NL500; Opening 2x/2.25x/2.5x/3x; stacks up to 300 (e.g. NL100 2x: 300,200,150,100,90,80,70,60,50,40,30,20; some 125 rows).
- 8max: 168 situations. No cold calls / With cold calls; Rakes cEV, LIVE 10%; Opening 2x,2.5x,3x,4x,5x,7x; Stacks 300,250,200,175,150,125,100.
- 9max: 8 situations. No cold calls / With cold calls; Rakes NL50, LIVE 10%; Opening GTO/2.5x; Stacks 100 (chips show 200,150,100 but rows seen are 100).

## Notes
- All 7 depths 200/150/100/75/50/40/20 exist for 6max General NL50 GTO/GTO Multi Size (used here: Cash6m50zGeneral). Depths 40, 20, 200 not read.
- Library banner: "full library is open this week" (Open Week promo); lock status of non-NL50 content not tested.
- Counts are as displayed by the UI list header; row lists are virtualized so only partial detail was captured for the large (1469/512/168) sets.
