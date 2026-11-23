#!/usr/bin/env python3
"""Parse hand-read GTO Wizard preflop chart files into a reusable dataset.

Usage (from /workspace/gtow, or with explicit paths):

    python3 build.py
    python3 build.py --raw raw --out dataset

Re-run anytime; new files in raw/ are picked up automatically. Stdlib only.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import OrderedDict, defaultdict
from datetime import date

RANKS = "AKQJT98765432"
RANK_INDEX = {r: i for i, r in enumerate(RANKS)}
# Early-to-late order covering 9-max, 8-max, 6-max and heads-up.
# Unknown labels still parse; they just sort after these.
POSITIONS = (
    "UTG", "UTG1", "UTG+1", "UTG2", "UTG+2", "UTG3",
    "EP", "EP1", "EP2",
    "MP", "MP1", "MP2", "MP3",
    "LJ", "HJ", "CO", "BTN", "BU",
    "SB", "BB",
)
POS_INDEX = {p: i for i, p in enumerate(POSITIONS)}
SPOT_TYPE_ORDER = {
    "rfi": 0,
    "vsOpen": 1,
    "vs3bet": 2,
    "vs4bet": 3,
    "vsLimpRaise": 4,
}
ACTIONS = ("fold", "call", "raise", "raise2", "raise3", "allin")
# R1= / bare R -> raise; R2= -> raise2; R3= -> raise3 (higher n = larger size).
RAISE_KEYS = {1: "raise", 2: "raise2", 3: "raise3"}
# Fallback first-in fold paths when a section index is not available.
SEAT_ORDERS = {
    2: ("SB", "BB"),
    6: ("UTG", "HJ", "CO", "BTN", "SB", "BB"),
    8: ("UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"),
    9: ("UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"),
}

# Matches a single hand token such as AKs:R45/C55 or A5s[0.62]:R30/F70 or AA:R2=67.5/R1=32.5
HAND_TOKEN_RE = re.compile(
    r"^\s*([AKQJT98765432]{2}[so]?)"
    r"(?:\[(\d+(?:\.\d+)?)\])?"
    r":([A-Za-z0-9./=?]+)\s*$"
)
# Two-size letters are only "R1=" / "R2=". Bare "R2" or "R24.8" is raise 2% / 24.8%.
ACTION_PART_RE = re.compile(r"^(R\d+=|[RCFA?])(\d+(?:\.\d+)?)?$")
# Filename: {gametype}_{depth}_{spot}.txt. The gametype may itself contain
# underscores (Cash8mLiveGeneral_8mcEVR2). The spot starts at RFI/vsOpen/…
FILE_RE = re.compile(
    r"^(?P<gametype>.+)_(?P<depth>\d+)_(?P<rest>RFI|vs(?:Open|3bet|4bet|LimpRaise)(?:_.*)?)\.txt$"
)
# Known GTO Wizard libraries in this extract. Values are defaults; a
# missing future id is still parsed from the filename/manifest/header.
KNOWN_LIBRARIES = {
    "Cash6m50zGeneral": {
        "players": 6, "rake": "NL50", "variant": "General", "pool": "General",
        "postflop": "Multi Size", "opening": "GTO", "cold_calls": False,
        "sizing": "Multi Size, GTO opens",
        "label": "6-max NL50 General (Multi Size)",
    },
    "Cash9m50zGeneral": {
        "players": 9, "rake": "NL50", "variant": "General", "pool": "General",
        "postflop": "Multi Size", "opening": "GTO", "cold_calls": False,
        "sizing": "Multi Size, GTO opens",
        "label": "9-max NL50 General (Multi Size)",
    },
    "CashHu500zComplex": {
        "players": 2, "rake": "NL500", "variant": "Complex", "pool": "Complex",
        "postflop": "Multi Size", "opening": "GTO", "cold_calls": False,
        "sizing": "Multi Size, Advanced/Complex",
        "label": "Heads-up NL500 Complex (Multi Size)",
    },
    "CashHu500zSimple": {
        "players": 2, "rake": "NL500", "variant": "Simple", "pool": "Simple",
        "postflop": "Multi Size", "opening": "GTO", "cold_calls": False,
        "sizing": "Multi Size, Simple",
        "label": "Heads-up NL500 Simple (Multi Size)",
    },
    "Cash8mLiveGeneral_8mcEVR2": {
        "players": 8, "rake": "cEV", "variant": "2x-coldcalls", "pool": "Live General",
        "postflop": "Single Size", "opening": "2x", "cold_calls": True,
        "sizing": "Single Size, 2x opens, with cold calls",
        "label": "8-max cEV Live 2x with cold calls (Single Size)",
    },
}
# Positions: 6-max UTG/HJ/CO/BTN/SB/BB; HU SB/BB; 9-max UTG1/UTG2/LJ/…
POS_TOKEN = (
    r"(?:UTG(?:\+?\d+)?|EP\d*|MP\d*|LJ|HJ|CO|BTN|BU|SB|BB)"
)
SPOT_REST_RE = re.compile(
    r"^(?:(?P<rfi>RFI)"
    r"|(?P<stype>vsOpen|vs3bet|vs4bet|vsLimpRaise)"
    r"_(?P<p1>" + POS_TOKEN + r")_(?P<p2>" + POS_TOKEN + r")"
    r"(?:_(?P<tag>(?:limp|raise|allin|AI|A|R\d+(?:\.\d+)?)(?:_(?:limp|raise|allin|AI|A|R\d+(?:\.\d+)?))*))?)$"
)
URL_RE = re.compile(r"https://[^\s|]+")
# Path tokens include RAI (all-in). RAI must be tried before R or A.
PATH_TOKEN = r"(?:RAI|R\d+(?:\.\d+)?|A|[FC])"
PATH_RE = re.compile(r"\bpath\s+(" + PATH_TOKEN + r"(?:-" + PATH_TOKEN + r")*)")
RESCALE_RE = re.compile(r"rescaled\s+x(\d+(?:\.\d+)?)", re.I)
# "Raise 2 17.6%", "R=Raise 22 11.7%", "R1=Raise 3 16.2%", "Raise ~3 33.9%"
RAISE_RE = re.compile(
    r"(?:R(\d+)=)?Raise\s+~?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*%"
)
# Two-number form first: "Allin 100 2.3%". One-number: "Allin 0%".
ALLIN_TWO_RE = re.compile(r"Allin\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*%")
ALLIN_ONE_RE = re.compile(r"Allin\s+(\d+(?:\.\d+)?)\s*%")
FOLD_RE = re.compile(r"\bFold\s+(\d+(?:\.\d+)?)\s*%")
CALL_RE = re.compile(r"(?:Call|Check(?:\(\s*C\s*\))?)\s+(\d+(?:\.\d+)?)\s*%")


def all_169_hands():
    hands = []
    for i, r1 in enumerate(RANKS):
        for j, r2 in enumerate(RANKS):
            if i == j:
                hands.append(r1 + r2)
            elif i < j:
                hands.append(r1 + r2 + "s")
            else:
                hands.append(r2 + r1 + "o")
    return hands


HANDS_169 = all_169_hands()
HAND_SET = set(HANDS_169)


def combos(hand):
    if len(hand) == 2:
        return 6
    if hand.endswith("s"):
        return 4
    return 12


def is_canonical_hand(hand):
    if hand in HAND_SET:
        return True
    return False


def clean_number(x):
    """Compact JSON/CSV number: int when whole, else trimmed float."""
    if x is None:
        return 0
    x = float(x)
    if abs(x - round(x)) < 1e-9:
        return int(round(x))
    r = round(x, 4)
    if abs(r - round(r)) < 1e-9:
        return int(round(r))
    return r


def empty_actions():
    return {k: 0 for k in ACTIONS}


def parse_action_string(acts):
    """Return (actions_dict, fold_was_listed, error_or_None). Frequencies in 0-100."""
    out = empty_actions()
    fold_listed = False
    if not acts:
        return out, False, "empty action string"
    for part in acts.split("/"):
        m = ACTION_PART_RE.match(part)
        if not m:
            return out, fold_listed, "unparseable action %r in %r" % (part, acts)
        letter, num = m.group(1), m.group(2)
        pct = 100.0 if num is None else float(num)
        if letter == "F":
            out["fold"] += pct
            fold_listed = True
        elif letter == "C":
            out["call"] += pct
        elif letter == "A":
            out["allin"] += pct
        elif letter == "?":
            # Some hand-reads use "?" for the larger raise instead of R2=.
            out["raise2"] += pct
        elif letter == "R" or (letter.startswith("R") and letter.endswith("=")):
            n = 1 if letter == "R" else int(letter[1:-1])
            key = RAISE_KEYS.get(n)
            if not key:
                return out, fold_listed, "unsupported raise size %r in %r" % (letter, acts)
            out[key] += pct
        else:
            return out, fold_listed, "unknown action letter %r in %r" % (letter, acts)
    return out, fold_listed, None


def action_sum(actions):
    return sum(actions[k] for k in ACTIONS)


def fill_remainder_fold(actions):
    remaining = 100.0 - action_sum(actions)
    if remaining > 1e-9:
        actions["fold"] = actions.get("fold", 0) + remaining


def detect_weights_are_percent(raw_weights):
    """If any [N] > 1, treat all as percent; if every [N] is <= 1, treat as a fraction."""
    if not raw_weights:
        return True
    return any(w > 1 for w in raw_weights)


def normalize_weight(raw, as_percent):
    if raw is None:
        return 100.0
    return float(raw) if as_percent else float(raw) * 100.0


def parse_overall_and_sizes(text):
    """Parse header/section frequencies (0-100) and bet sizes in bb."""
    overall = {k: 0 for k in ACTIONS}
    sizes = {}

    raises = RAISE_RE.findall(text)
    # Each hit: (r_index or '', size, freq)
    raise_entries = []
    for idx, size, freq in raises:
        raise_entries.append((idx, float(size), float(freq)))

    if raise_entries:
        labelled = [e for e in raise_entries if e[0]]
        if len(raise_entries) == 1:
            _idx, size, freq = raise_entries[0]
            sizes["raise"] = size
            overall["raise"] = freq
        elif labelled and all(e[0] for e in raise_entries):
            by = {e[0]: e for e in raise_entries}
            for idx, (_i, size, freq) in by.items():
                key = RAISE_KEYS.get(int(idx))
                if key:
                    sizes[key] = size
                    overall[key] = freq
        else:
            # Unlabelled sizes: smallest is R1/raise, next R2/raise2, largest R3/raise3.
            ordered = sorted(raise_entries, key=lambda e: e[1])
            for i, (_idx, size, freq) in enumerate(ordered, start=1):
                key = RAISE_KEYS.get(i)
                if key:
                    sizes[key] = size
                    overall[key] = freq

    folds = FOLD_RE.findall(text)
    if folds:
        overall["fold"] = float(folds[0])
    calls = CALL_RE.findall(text)
    if calls:
        overall["call"] = float(calls[0])

    two = ALLIN_TWO_RE.search(text)
    one_only = None
    if two:
        # "Allin 100 2.3%" — but "Allin 0%" should not be consumed as size=0 freq=next.
        # two-number regex requires two numbers, so "Allin 0%" is left to one-number.
        sizes["allin"] = float(two.group(1))
        overall["allin"] = float(two.group(2))
    else:
        one_only = ALLIN_ONE_RE.search(text)
        if one_only:
            overall["allin"] = float(one_only.group(1))

    return overall, sizes


def extract_notes(header):
    notes = []
    m = RESCALE_RE.search(header)
    if m:
        notes.append("weights [N] rescaled x%s so combo totals match the overview panel" % m.group(1))
    if re.search(r"unconfirmed", header, re.I):
        notes.append("a size in this file is unconfirmed (see source header)")
    if re.search(r"no limp option", header, re.I):
        notes.append("no limp option at this depth")
    if re.search(r"0\.5%\s*precision", header, re.I):
        notes.append("hand-read at 0.5% precision")
    if re.search(r"0\.1%\s*precision", header, re.I):
        notes.append("hand-read at 0.1% precision")
    return notes, (float(m.group(1)) if m else None)


def parse_gametype_id(gametype):
    """Pull players, rake and pool out of a GTO Wizard gametype id.

    The id is authoritative (from the filename, or the manifest if needed).
    Nothing here assumes 6-max.
    """
    players = None
    rake = None
    pool = None
    if not gametype:
        return players, rake, pool
    if re.search(r"Cash(?:Hu|HU|hu)", gametype) or re.search(
        r"heads?-?up", gametype, re.I
    ):
        players = 2
    else:
        m = re.search(r"Cash(\d+)m", gametype)
        if m:
            players = int(m.group(1))
        else:
            m = re.search(r"(\d+)max", gametype, re.I)
            if m:
                players = int(m.group(1))
    # Cash6m50zGeneral, CashHu50zAdvanced, Cash6mcEVzGeneral, Cash8mLiveGeneral_8mcEVR2
    if re.search(r"cEV", gametype, re.I):
        rake = "cEV"
    else:
        m = re.search(r"(?:Cash(?:Hu|HU|hu|\d+m))(\d+)(GG)?z", gametype)
        if m:
            rake = "NL%s%s" % (m.group(1), " GG" if m.group(2) else "")
    m = re.search(r"z([A-Za-z][A-Za-z0-9]*)$", gametype)
    if m:
        pool = m.group(1)
    elif re.search(r"Simple", gametype, re.I):
        pool = "Simple"
    elif re.search(r"Complex", gametype, re.I):
        pool = "Complex"
    return players, rake, pool


def infer_players(gametype, header_text="", rfi_heroes=None):
    """Players from the gametype, then the file header, then RFI seat count."""
    players, _, _ = parse_gametype_id(gametype)
    if players:
        return players
    if header_text:
        if re.search(r"heads?-?up|\bHU\b", header_text, re.I):
            return 2
        m = re.search(r"\b(\d+)\s*-?\s*max\b", header_text, re.I)
        if m:
            return int(m.group(1))
    if rfi_heroes:
        # Opening seats plus the big blind.
        return len(set(rfi_heroes)) + 1
    return None


def rfi_path_for(hero, players, section_index=None):
    """Folded-to-hero path. Prefer the section's order in the RFI file."""
    if section_index is not None:
        return "-".join(["F"] * section_index) if section_index else ""
    order = SEAT_ORDERS.get(players) or ()
    if hero in order:
        i = order.index(hero)
        return "-".join(["F"] * i) if i else ""
    return ""


def rfi_url(gametype, depth, path):
    base = "https://app.gtowizard.com/solutions?gametype=%s&depth=%s" % (gametype, depth)
    if not path:
        return base
    n = path.count("-") + 1
    return "%s&preflop_actions=%s&history_spot=%s" % (base, path, n)


def load_manifest(raw_dir):
    path = os.path.join(raw_dir, "MANIFEST.tsv")
    rows = {}
    if not os.path.isfile(path):
        return rows
    with open(path, encoding="utf-8") as f:
        header = f.readline()
        if not header:
            return rows
        cols = header.rstrip("\n").split("\t")
        for line in f:
            parts = line.rstrip("\n").split("\t")
            row = {cols[i]: parts[i] if i < len(parts) else "" for i in range(len(cols))}
            name = row.get("file") or row.get("filename")
            if name:
                rows[name] = row
    return rows


def library_info(gametype):
    """Defaults for a known library, or a best-effort parse of an unseen id."""
    if gametype in KNOWN_LIBRARIES:
        return dict(KNOWN_LIBRARIES[gametype])
    players, rake, pool = parse_gametype_id(gametype)
    variant = pool or "General"
    if players == 2:
        if re.search(r"Simple", gametype or "", re.I):
            variant = "Simple"
        elif re.search(r"Complex", gametype or "", re.I):
            variant = "Complex"
    elif players == 8:
        variant = "2x-coldcalls" if re.search(r"R2|cEV", gametype or "", re.I) else (pool or "Live")
    info = {
        "players": players, "rake": rake, "variant": variant, "pool": pool,
        "postflop": None, "opening": None, "cold_calls": None,
        "sizing": None, "label": gametype,
    }
    return info


def split_filename(name, manifest_row=None, known_gametypes=None):
    """Split {gametype}_{depth}_{rest}.txt. Gametype may contain underscores."""
    # 1. Manifest gametype column (handles ids with underscores).
    if manifest_row and manifest_row.get("gametype"):
        gt = manifest_row["gametype"]
        depth_s = str(manifest_row.get("depth") or "")
        if depth_s:
            prefix = "%s_%s_" % (gt, depth_s)
            if name.startswith(prefix) and name.endswith(".txt"):
                return gt, int(depth_s), name[len(prefix):-4], None
        m = re.match(re.escape(gt) + r"_(\d+)_(.+)\.txt$", name)
        if m:
            return gt, int(m.group(1)), m.group(2), None
    # 2. Known prefixes, longest first.
    known = []
    for g in list(known_gametypes or []) + list(KNOWN_LIBRARIES):
        if g and g not in known:
            known.append(g)
    known.sort(key=len, reverse=True)
    for g in known:
        m = re.match(re.escape(g) + r"_(\d+)_(.+)\.txt$", name)
        if m:
            return g, int(m.group(1)), m.group(2), None
    # 3. Generic: last _<digits>_ before an RFI/vs* spot name.
    m = FILE_RE.match(name)
    if m:
        return m.group("gametype"), int(m.group("depth")), m.group("rest"), None
    return None, None, None, "unrecognised filename, skipped: %s" % name


def infer_vsopen_roles(path, players, p1, p2):
    """Work out hero and villain for a vsOpen file.

    6-max and HU dumps are named vsOpen_{villain}_{hero}. 8-max and 9-max
    dumps are named vsOpen_{hero}_{villain}. The action path is authoritative
    when it is present: walk the table's seat order, the first non-fold is
    the opener (villain), and the next seat to act is hero.
    """
    order = list(SEAT_ORDERS.get(players) or ())
    if path and order:
        idx = 0
        villain = None
        for tok in path.split("-"):
            if idx >= len(order):
                break
            if tok == "F":
                idx += 1
                continue
            villain = order[idx]
            idx += 1
        hero = order[idx] if idx < len(order) else None
        if hero and villain:
            return hero, villain, "path"
    if players in (8, 9):
        return p1, p2, "name-hero-first"
    return p2, p1, "name-villain-first"


def parse_filename(name, manifest_row=None, known_gametypes=None):
    """Return (info, error). error is a warning string when the file is skipped."""
    gametype, depth, rest, err = split_filename(name, manifest_row, known_gametypes)
    if err:
        return None, err
    lib = library_info(gametype)
    players, rake, pool = lib.get("players"), lib.get("rake"), lib.get("pool")
    parsed_players, parsed_rake, parsed_pool = parse_gametype_id(gametype)
    players = players or parsed_players
    rake = rake or parsed_rake
    pool = pool or parsed_pool
    if manifest_row:
        if not rake and manifest_row.get("rake"):
            rake = manifest_row["rake"]
        if not pool and manifest_row.get("pool"):
            pool = manifest_row["pool"]
    file_gt_guess = None
    m_guess = FILE_RE.match(name)
    if m_guess:
        file_gt_guess = m_guess.group("gametype")
    info = {
        "gametype": gametype,
        "players": players,
        "rake": rake,
        "pool": pool,
        "variant": lib.get("variant") or pool or "General",
        "opening": lib.get("opening"),
        "cold_calls": lib.get("cold_calls"),
        "postflop": lib.get("postflop"),
        "sizing": lib.get("sizing"),
        "depth": depth,
        "rest": rest,
        "manifest_mismatch": (
            manifest_row
            and manifest_row.get("gametype")
            and manifest_row["gametype"] != gametype
        ),
    }
    rest_m = SPOT_REST_RE.match(info["rest"])
    if not rest_m:
        return None, "unrecognised spot name in %s (rest %r)" % (name, info["rest"])
    if rest_m.group("rfi"):
        info["spot_type"] = "rfi"
        info["multi"] = True
        return info, None
    stype = rest_m.group("stype")
    p1, p2, tag = rest_m.group("p1"), rest_m.group("p2"), rest_m.group("tag")
    info["spot_type"] = stype
    info["tag"] = tag
    info["p1"], info["p2"] = p1, p2
    # vs3bet / vs4bet / vsLimpRaise are always {type}_{hero}_{villain}[_{sizes}].
    # vsOpen naming differs by table size; resolved from the path later.
    if stype == "vsOpen":
        hero, villain, _how = infer_vsopen_roles(None, players, p1, p2)
        info["hero"], info["villain"] = hero, villain
    else:
        info["hero"], info["villain"] = p1, p2
    return info, None


def make_spot_id(players, depth, spot_type, hero, villain, tag, variant=None, include_variant=False):
    if include_variant and variant:
        prefix = "cash|%s|%s|%s|" % (players, depth, str(variant).lower())
    else:
        prefix = "cash|%s|%s|" % (players, depth)
    if spot_type == "rfi":
        return prefix + "rfi:%s" % hero
    if spot_type == "vsOpen":
        # "_raise" is the default facing-an-open and is omitted so the id
        # matches the app (vs:BB:SB). limp / allin are kept as a suffix.
        if tag and tag not in ("raise",):
            return prefix + "vs:%s:%s:%s" % (hero, villain, tag)
        return prefix + "vs:%s:%s" % (hero, villain)
    if spot_type == "vs3bet":
        base = prefix + "v3:%s:%s" % (hero, villain)
        if tag:
            base += ":" + tag.replace("_", ":")
        return base
    if spot_type == "vs4bet":
        base = prefix + "v4:%s:%s" % (hero, villain)
        if tag:
            base += ":" + tag.replace("_", ":")
        return base
    if spot_type == "vsLimpRaise":
        suffix = (tag.replace("_", ":") if tag else "raise")
        return prefix + "vl:%s:%s:%s" % (hero, villain, suffix)
    return prefix + "%s:%s:%s" % (spot_type, hero, villain or "")


def id_safe(spot_id):
    return spot_id.replace("|", "-").replace(":", "-")


def default_unlisted(spot_type):
    # vsOpen and RFI: unlisted hands are pure fold.
    # vs3bet / vs4bet / vsLimpRaise: unlisted hands are not in the range.
    return "fold" if spot_type in ("rfi", "vsOpen") else "not_in_range"


def parse_hand_body(body, unlisted_policy):
    """Parse comma-separated hand tokens. Returns (listed, issues, as_percent).

    listed: OrderedDict hand -> {weight, actions, fold_listed, raw}
    issues: list of dicts {kind, message, hand?}
    """
    issues = []
    listed = OrderedDict()
    chunks = [c for c in body.split(",") if c.strip()]
    raw_weights = []
    parsed_chunks = []

    for chunk in chunks:
        m = HAND_TOKEN_RE.match(chunk)
        if not m:
            issues.append({
                "kind": "unparseable",
                "message": "unparseable token %r" % chunk.strip(),
            })
            continue
        hand, w_s, acts = m.group(1), m.group(2), m.group(3)
        if not is_canonical_hand(hand):
            issues.append({
                "kind": "unparseable",
                "hand": hand,
                "message": "non-canonical or invalid hand %r in %r" % (hand, chunk.strip()),
            })
            continue
        raw_w = float(w_s) if w_s is not None else None
        if raw_w is not None:
            raw_weights.append(raw_w)
        actions, fold_listed, err = parse_action_string(acts)
        if err:
            issues.append({
                "kind": "unparseable",
                "hand": hand,
                "message": err,
            })
            continue
        parsed_chunks.append((hand, raw_w, actions, fold_listed, chunk.strip()))

    as_percent = detect_weights_are_percent(raw_weights)

    for hand, raw_w, actions, fold_listed, raw in parsed_chunks:
        if hand in listed:
            issues.append({
                "kind": "duplicate",
                "hand": hand,
                "message": "duplicate hand %s (later token %r kept)" % (hand, raw),
            })
        if not fold_listed:
            fill_remainder_fold(actions)
        weight = normalize_weight(raw_w, as_percent)
        listed[hand] = {
            "weight": weight,
            "actions": actions,
            "fold_listed": fold_listed,
            "raw": raw,
        }
    return listed, issues, as_percent


def expand_hands(listed, unlisted_policy):
    """Build the full 169-hand map with weights and action %."""
    hands = {}
    for hand in HANDS_169:
        if hand in listed:
            rec = listed[hand]
            entry = {"weight": clean_number(rec["weight"])}
            for k in ACTIONS:
                entry[k] = clean_number(rec["actions"][k])
            hands[hand] = entry
        elif unlisted_policy == "fold":
            entry = {"weight": 100, "fold": 100, "call": 0, "raise": 0, "raise2": 0, "raise3": 0, "allin": 0}
            hands[hand] = entry
        else:
            entry = {"weight": 0, "fold": 0, "call": 0, "raise": 0, "raise2": 0, "raise3": 0, "allin": 0}
            hands[hand] = entry
    return hands


def compute_overall(hands):
    """Combo-weighted overall frequencies (0-100) over hands that reach the node."""
    totals = {k: 0.0 for k in ACTIONS}
    reaching = 0.0
    for hand, rec in hands.items():
        w = float(rec["weight"]) / 100.0
        if w <= 0:
            continue
        c = combos(hand) * w
        reaching += c
        for k in ACTIONS:
            totals[k] += c * (float(rec[k]) / 100.0)
    if reaching <= 0:
        return {k: 0 for k in ACTIONS}, 0.0
    overall = {k: clean_number(100.0 * totals[k] / reaching) for k in ACTIONS}
    return overall, reaching


def overall_gaps(header_overall, computed):
    gaps = {}
    for k in ACTIONS:
        h = float(header_overall.get(k) or 0)
        c = float(computed.get(k) or 0)
        gaps[k] = c - h
    return gaps


def parse_tokens_from_lines(lines):
    """Join non-header lines into a hand body."""
    body_lines = []
    for line in lines:
        if line.startswith("#"):
            continue
        body_lines.append(line)
    return ",".join(body_lines)


def split_rfi_sections(text):
    """Yield (section_header_line, body_text) for each ## POS (...) block."""
    lines = text.splitlines()
    sections = []
    i = 0
    # skip file-level # header(s)
    while i < len(lines) and (lines[i].startswith("#") and not lines[i].startswith("##")):
        i += 1
    while i < len(lines):
        if lines[i].startswith("##"):
            header = lines[i]
            i += 1
            body = []
            while i < len(lines) and not lines[i].startswith("##"):
                if not (lines[i].startswith("#") and not lines[i].startswith("##")):
                    body.append(lines[i])
                i += 1
            sections.append((header, "\n".join(body)))
        else:
            i += 1
    return sections


SECTION_POS_RE = re.compile(r"^##\s*(" + POS_TOKEN + r")\s*(?:\((.*?)\))?\s*(.*)$")


def build_spot(meta, header, body, source_file, file_notes=None, extra_note=None):
    issues = []
    unlisted = default_unlisted(meta["spot_type"])
    listed, parse_issues, as_percent = parse_hand_body(body, unlisted)
    issues.extend(parse_issues)

    hands = expand_hands(listed, unlisted)
    computed, reaching = compute_overall(hands)
    header_overall, sizes = parse_overall_and_sizes(header)
    notes, rescale = extract_notes(header)
    if file_notes:
        for n in file_notes:
            if n not in notes:
                notes.append(n)
    if extra_note and extra_note not in notes:
        notes.append(extra_note)

    url_m = URL_RE.search(header)
    path_m = PATH_RE.search(header)
    url = url_m.group(0) if url_m else meta.get("url")
    action_path = path_m.group(1) if path_m else meta.get("action_path", "")

    # Flag hands whose actions don't sum to 100±0.6 (in-range only).
    for hand, rec in listed.items():
        s = action_sum(rec["actions"])
        if abs(s - 100.0) > 0.6:
            issues.append({
                "kind": "action_sum",
                "hand": hand,
                "message": "%s actions sum to %s (expected 100±0.6)" % (hand, clean_number(s)),
                "sum": s,
            })

    gaps = overall_gaps(header_overall, computed)
    max_gap = max(abs(v) for v in gaps.values()) if gaps else 0.0
    if max_gap > 1.0:
        bits = ", ".join(
            "%s header %s vs computed %s (Δ %+0.2f pp)"
            % (k, clean_number(header_overall.get(k) or 0), computed[k], gaps[k])
            for k in ACTIONS
            if abs(gaps[k]) > 1.0
        )
        issues.append({
            "kind": "overall_gap",
            "message": "overall frequency gap > 1pp: %s" % bits,
            "gaps": gaps,
            "max_gap": max_gap,
        })

    hero = meta.get("hero")
    villain = meta.get("villain")
    tag = meta.get("tag")
    lib_variant = meta.get("variant")
    include_variant = bool(meta.get("include_variant")) or (meta.get("players") == 2)
    spot_id = make_spot_id(
        meta["players"], meta["depth"], meta["spot_type"], hero, villain, tag,
        variant=lib_variant, include_variant=include_variant,
    )

    overall_out = {k: clean_number(header_overall.get(k) or 0) for k in ACTIONS}
    sizes_out = {k: clean_number(v) for k, v in sizes.items()}

    spot = OrderedDict()
    spot["id"] = spot_id
    spot["gametype"] = meta["gametype"]
    spot["players"] = meta["players"]
    spot["rake"] = meta["rake"]
    if meta.get("variant"):
        spot["variant"] = meta["variant"]
    if meta.get("opening"):
        spot["opening"] = meta["opening"]
    if meta.get("cold_calls") is not None:
        spot["cold_calls"] = meta["cold_calls"]
    if meta.get("postflop"):
        spot["postflop"] = meta["postflop"]
    spot["depth"] = meta["depth"]
    spot["spot_type"] = meta["spot_type"]
    spot["hero"] = hero
    spot["villain"] = villain
    spot["action_path"] = action_path or ""
    if tag:
        spot["tag"] = tag.replace("_", ":")
    spot["sizes"] = sizes_out
    spot["overall"] = overall_out
    spot["overall_computed"] = computed
    spot["combos_reaching"] = clean_number(reaching)
    spot["unlisted"] = unlisted
    spot["weight_unit_detected"] = "percent" if as_percent else "fraction"
    if url:
        spot["url"] = url
    spot["source_file"] = source_file
    if rescale is not None:
        spot["weight_rescale"] = clean_number(rescale)
    if notes:
        spot["note"] = "; ".join(notes)
    spot["hands"] = hands

    validation = {
        "id": spot_id,
        "source_file": source_file,
        "n_listed": len(listed),
        "unlisted": unlisted,
        "header_overall": overall_out,
        "computed_overall": computed,
        "gaps": {k: clean_number(v) for k, v in gaps.items()},
        "max_gap_pp": clean_number(max_gap),
        "combos_reaching": clean_number(reaching),
        "issues": issues,
        "flagged": bool(issues),
    }
    return spot, validation


def parse_raw_file(path, manifest=None, known_gametypes=None):
    """Return lists of (spot, validation) plus file-level warnings."""
    name = os.path.basename(path)
    warnings = []
    manifest_row = (manifest or {}).get(name)
    meta, err = parse_filename(name, manifest_row, known_gametypes)
    if meta is None:
        return [], [err or ("unrecognised filename, skipped: %s" % name)]
    if meta.get("manifest_mismatch"):
        warnings.append(
            "manifest gametype %r != filename gametype %r in %s"
            % (manifest_row.get("gametype"), meta["gametype"], name)
        )

    text = open(path, encoding="utf-8").read()
    if not text.strip():
        return [], ["empty file, skipped: %s" % name]

    lines = text.splitlines()
    file_header = "\n".join(l for l in lines if l.startswith("#") and not l.startswith("##"))
    file_notes, _ = extract_notes(file_header)

    url_m = URL_RE.search(file_header)
    if url_m:
        meta["url"] = url_m.group(0)
    path_m = PATH_RE.search(file_header)
    if path_m:
        meta["action_path"] = path_m.group(1)
    if meta.get("spot_type") == "vsOpen":
        hero, villain, _how = infer_vsopen_roles(
            meta.get("action_path"), meta.get("players"),
            meta.get("p1"), meta.get("p2"),
        )
        if hero and villain:
            meta["hero"], meta["villain"] = hero, villain

    results = []
    if meta["spot_type"] == "rfi":
        sections = split_rfi_sections(text)
        if not sections:
            return [], ["RFI file has no ## position sections: %s" % name]
        # Sections are assumed to appear in first-to-act order, so the path
        # for the k-th opener is k folds. That works for HU, 6-max and 9-max.
        rfi_heroes = []
        for sec_header, _body in sections:
            sm = SECTION_POS_RE.match(sec_header.strip())
            if sm:
                rfi_heroes.append(sm.group(1))
        if not meta.get("players"):
            meta["players"] = infer_players(meta["gametype"], file_header, rfi_heroes)
            if not meta["players"]:
                warnings.append("could not infer table size for %s; spot ids need a player count" % name)
        if not meta.get("rake"):
            rm = re.search(r"\b(NL\s*\d+(?:\s*GG)?|cEV|LIVE\s*10%)\b", file_header, re.I)
            if rm:
                meta["rake"] = re.sub(r"\s+", " ", rm.group(1)).replace("Nl", "NL").replace("nl", "NL")
        for i, (sec_header, body) in enumerate(sections):
            sm = SECTION_POS_RE.match(sec_header.strip())
            if not sm:
                warnings.append("unrecognised RFI section header in %s: %r" % (name, sec_header))
                continue
            sec_meta = dict(meta)
            sec_meta["hero"] = sm.group(1)
            sec_meta["villain"] = None
            sec_meta["tag"] = None
            path = rfi_path_for(sec_meta["hero"], sec_meta.get("players"), section_index=i)
            sec_meta["action_path"] = path
            sec_meta["url"] = rfi_url(meta["gametype"], meta["depth"], path)
            # Prefer the section header for overall/sizes (it has the raise size).
            header_for_parse = sec_header + "\n" + file_header
            extra = None
            if sec_meta["hero"] == "SB" and re.search(r"Call|remainder fold", sec_header, re.I):
                extra = "SB RFI: C is a limp; remainder after R/C is fold"
            spot, val = build_spot(
                sec_meta, header_for_parse, body, name,
                file_notes=file_notes, extra_note=extra,
            )
            results.append((spot, val))
        return results, warnings

    if not meta.get("players"):
        meta["players"] = infer_players(meta["gametype"], file_header)
        if not meta["players"]:
            warnings.append("could not infer table size for %s; spot ids need a player count" % name)
    if not meta.get("rake"):
        rm = re.search(r"\b(NL\s*\d+(?:\s*GG)?|cEV|LIVE\s*10%)\b", file_header, re.I)
        if rm:
            meta["rake"] = re.sub(r"\s+", " ", rm.group(1)).replace("Nl", "NL").replace("nl", "NL")
    body = parse_tokens_from_lines(lines)
    spot, val = build_spot(meta, file_header, body, name, file_notes=file_notes)
    results.append((spot, val))
    return results, warnings


def sort_key(spot):
    players = spot.get("players")
    players_key = players if isinstance(players, int) else 99
    return (
        players_key,
        spot.get("gametype") or "",
        (spot.get("variant") or "").lower(),
        spot["depth"],
        SPOT_TYPE_ORDER.get(spot["spot_type"], 99),
        POS_INDEX.get(spot["hero"] or "", 99),
        POS_INDEX.get(spot["villain"] or "", 99),
        spot.get("tag") or "",
        spot["id"],
    )


def build_libraries_meta(spots):
    libs = OrderedDict()
    for s in spots:
        gt = s.get("gametype")
        if not gt:
            continue
        if gt not in libs:
            base = library_info(gt)
            entry = OrderedDict()
            for k in (
                "label", "players", "rake", "variant", "pool",
                "postflop", "opening", "cold_calls", "sizing",
            ):
                if base.get(k) is not None:
                    entry[k] = base[k]
            entry["depths"] = []
            entry["n_spots"] = 0
            libs[gt] = entry
        libs[gt]["n_spots"] += 1
        d = s["depth"]
        if d not in libs[gt]["depths"]:
            libs[gt]["depths"].append(d)
    for e in libs.values():
        e["depths"] = sorted(e["depths"])
    return libs


APP_OMIT = ("overall_computed", "weight_unit_detected", "source_file", "combos_reaching")


def slim_spot(spot):
    out = OrderedDict()
    for k, v in spot.items():
        if k not in APP_OMIT:
            out[k] = v
    return out


def write_app_bundle(app_dir, doc, spots):
    os.makedirs(app_dir, exist_ok=True)
    for name in os.listdir(app_dir):
        if name.endswith(".json"):
            os.remove(os.path.join(app_dir, name))
    by_gt = OrderedDict()
    for s in spots:
        by_gt.setdefault(s["gametype"], []).append(s)
    index = OrderedDict()
    index["format"] = "holdem-lab.spots-index"
    index["version"] = 1
    index["source"] = doc["source"]
    index["extracted"] = doc["extracted"]
    index["libraries"] = doc.get("libraries")
    index["n_spots"] = doc.get("n_spots")
    index["files"] = []
    written = []
    for gt, group in by_gt.items():
        fname = gt + ".json"
        part = OrderedDict()
        part["format"] = "holdem-lab.spots"
        part["version"] = 1
        part["source"] = doc["source"]
        part["extracted"] = doc["extracted"]
        part["gametype"] = gt
        if doc.get("libraries") and gt in doc["libraries"]:
            part["library"] = doc["libraries"][gt]
        part["n_spots"] = len(group)
        part["spots"] = [slim_spot(s) for s in group]
        path = os.path.join(app_dir, fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(part, ensure_ascii=False, separators=(",", ":")) + "\n")
        written.append(path)
        index["files"].append(OrderedDict([
            ("gametype", gt),
            ("file", fname),
            ("n_spots", len(group)),
            ("players", group[0].get("players")),
            ("rake", group[0].get("rake")),
            ("variant", group[0].get("variant")),
        ]))
    index_path = os.path.join(app_dir, "index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(index, indent=2, ensure_ascii=False) + "\n")
    written.append(index_path)
    return written


def write_csv(path, hands):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["hand", "weight", "fold", "call", "raise", "raise2", "raise3", "allin"])
        for hand in HANDS_169:
            rec = hands[hand]
            w.writerow([
                hand,
                rec["weight"],
                rec["fold"],
                rec["call"],
                rec["raise"],
                rec["raise2"],
                rec["raise3"],
                rec["allin"],
            ])


def count_table(spots):
    """Counts keyed by (players, gametype, depth) so mixed tables stay distinct."""
    table = defaultdict(lambda: defaultdict(int))
    for s in spots:
        key = (s.get("players"), s.get("gametype") or "", s["depth"])
        table[key][s["spot_type"]] += 1
    return table


def coverage_markdown(by, libraries=None):
    types = ["rfi", "vsOpen", "vs3bet", "vs4bet", "vsLimpRaise"]
    if not by:
        return "_No spots._\n"
    keys = sorted(by, key=lambda k: (
        k[0] if isinstance(k[0], int) else 99, k[1], k[2]
    ))
    lines = []
    lines.append("| Players | Gametype | Variant | Depth | " + " | ".join(types) + " | Total |")
    lines.append("| --- | --- | --- | --- | " + " | ".join("---" for _ in types) + " | --- |")
    libs = libraries or {}
    for key in keys:
        players, gametype, depth = key
        variant = (libs.get(gametype) or {}).get("variant") or "—"
        counts = by[key]
        total = 0
        nums = []
        for t in types:
            n = counts.get(t, 0)
            total += n
            nums.append(str(n) if n else "—")
        lines.append("| %s | `%s` | %s | %sbb | %s | %s |" % (
            players, gametype, variant, depth, " | ".join(nums), total,
        ))
    return "\n".join(lines) + "\n"


def libraries_markdown(libraries):
    if not libraries:
        return ""
    lines = [
        "| Gametype | Players | Rake | Variant | Sizing |",
        "| --- | --- | --- | --- | --- |",
    ]
    for gt, lib in libraries.items():
        sizing = lib.get("sizing") or "—"
        lines.append("| `%s` | %s | %s | %s | %s |" % (
            gt, lib.get("players") or "—", lib.get("rake") or "—",
            lib.get("variant") or "—", sizing,
        ))
    return "\n".join(lines) + "\n"


def render_readme(n_files, n_spots, depths, out_rel="dataset", by=None, libraries=None, skipped=0):
    coverage = coverage_markdown(by, libraries)
    lib_table = libraries_markdown(libraries)
    return """# GTO Wizard cash preflop dataset (hand-read)

Personal-study extract of GTO Wizard cash preflop charts, typed from the
solution matrix. This is **not** a download from GTO Wizard and must not be
republished as GTO Wizard data. Frequencies are only as accurate as a hand
read (typically 0.5 percentage points; some depths were read at 0.1).

The pipeline is not limited to 6-max. Gametype, player count, rake and
sizing come from the filename and from `raw/MANIFEST.tsv` (the manifest
`gametype` column is used when the id itself contains underscores, as
with `Cash8mLiveGeneral_8mcEVR2`). Heads-up Complex/Simple, 9-max and
8-max dumps all live under their GTO Wizard gametype id.

Regenerated by `build.py` from `raw/*.txt`.

## How to re-run

From `/workspace/gtow`:

```bash
python3 build.py
```

Or with explicit paths:

```bash
python3 build.py --raw raw --out dataset
```

The script uses the Python standard library only. It globbs every `raw/*.txt`
each run, so new depths, table sizes or spots can be dropped into `raw/` and
the dataset rebuilt. Outputs are overwritten. `raw/MANIFEST.tsv` and
`raw/LIBRARY_INDEX.md` are the collection log and library map. The manifest
`gametype` column is the source of truth when it is present; otherwise the
filename is matched against known prefixes or the pattern
`{gametype}_{depth}_{RFI|vs…}.txt`.

## Outputs

| Path | What it is |
| --- | --- |
| `dataset/gtow-cash.json` | All spots in one file, `holdem-lab.spots` version 1 with extra study fields |
| `dataset/csv/<id-safe>.csv` | One CSV per spot: `hand,weight,fold,call,raise,raise2,raise3,allin` (all 169 hands) |
| `dataset/VALIDATION.md` | Combo-weighted checks against each file's header |

On the last run this directory was built from **%(n_files)s** raw files into **%(n_spots)s** spots (skipped: %(skipped)s) at depths %(depths)s.

A compact, per-gametype copy (without computed-check fields) is written to
`dataset/app/<gametype>.json`, with an index at `dataset/app/index.json`.

Hold'em Lab does not ship that full JSON. `pack_app.py` (or `build.py --web`)
writes a much smaller bundle the static site lazy-loads, one gametype at a
time: pure folds are omitted and each hand is a short token (`AA:R`,
`AKs:R45/C55`, `76s@12.5:R20/F80`). Frequencies in both files are percents
from 0 to 100.

```bash
python3 build.py --raw raw --out dataset --web app
```

## Coverage

%(coverage)s
## Libraries

%(lib_table)s
## Filenames

```
{gametype}_{depth}_{spot}.txt
```

`gametype` is the GTO Wizard id and **may contain underscores**
(`Cash6m50zGeneral`, `CashHu500zComplex`, `Cash9m50zGeneral`,
`Cash8mLiveGeneral_8mcEVR2`). Player count is parsed from that id:
`Cash6m…` → 6, `Cash9m…` → 9, `Cash8m…` → 8, `CashHu…` / `CashHU…` → 2.
Rake, variant and sizing are recorded per gametype in the JSON `libraries`
object (NL50, cEV, Complex/Simple, 2x opens with cold calls, …). Spot ids
look like `cash|<players>|<depth>|…`. Heads-up also inserts the variant, so
a Complex 100bb SB open is `cash|2|100|complex|rfi:SB` and a Simple 200bb
open is `cash|2|200|simple|rfi:SB`.

Position labels accepted in filenames and RFI `##` section headers: `UTG`,
`UTG1`, `UTG2`, `UTG+1`, `LJ`, `HJ`, `CO`, `BTN`, `SB`, `BB`, and other
`EP`/`MP` variants. RFI files may list several `## POS (…)` sections; they
are assumed to appear in first-to-act order, which yields the correct
fold-to-hero path for heads-up, 6-max and 9-max.

## Spot ids

Ids follow the Hold'em Lab convention (`docs/spot-import.md` in tamctr/holdem-app-test):

```
cash|<players>|<stack bb>|<kind>:<hero>:<villain>
```

| Spot type | Id example | Meaning |
| --- | --- | --- |
| `rfi` | `cash\\|6\\|100\\|rfi:BTN` | Folded to hero, first in |
| `rfi` (HU) | `cash\\|2\\|100\\|complex\\|rfi:SB` | Heads-up first-in; variant is in the id |
| `vsOpen` | `cash\\|6\\|100\\|vs:BB:BTN` | Hero faces villain's open (others folded) |
| `vsOpen` (SB limp) | `cash\\|6\\|100\\|vs:BB:SB:limp` | Big blind vs a small-blind limp (check / two raise sizes) |
| `vsOpen` (SB shove) | `cash\\|6\\|20\\|vs:BB:SB:allin` | Big blind call/fold vs an SB open-shove (`path` ends in `RAI`) |
| `vs3bet` | `cash\\|6\\|100\\|v3:BTN:BB` | Original opener faces a 3-bet |
| `vs3bet` (sized) | `cash\\|2\\|60\\|v3:SB:BB:R6.5` | Faces a 3-bet of a particular size (when several 3-bet sizes exist) |
| `vs4bet` | `cash\\|6\\|100\\|v4:BB:BTN` | 3-bettor faces a 4-bet |
| `vs4bet` (sized) | `cash\\|2\\|60\\|v4:BB:SB:R6.5:AI` | Faces a 4-bet all-in after a 3-bet to 6.5bb (`path` `R2-R6.5-RAI`) |
| `vsLimpRaise` | `cash\\|6\\|100\\|vl:SB:BB:R3` | SB, after limping, faces a BB raise to 3bb |
| `vsLimpRaise` (shove) | `cash\\|6\\|20\\|vl:SB:BB:AI` | SB, after limping, faces a BB shove (`path` ends in `RAI`) |

CSV filenames use the id with `|` and `:` replaced by `-`, e.g. `cash-6-100-vs-BB-BTN.csv`.

A vsOpen file named `vsOpen_SB_BB_raise` (6-max / HU: villain then hero) or
`vsOpen_BB_BTN` (8-max / 9-max: hero then villain) both become `vs:HERO:VILLAIN`.
The action path in the header is the source of truth for those roles. The
`_raise` tag is dropped from the id so it matches the app. Other suffixes are
kept: `_limp` → `:limp`, `_allin` → `:allin`, and limp-raise or 4-bet size
chains stay on the id (`vl:SB:BB:R8.5`, `v4:BB:SB:R6.5:R16`).

Heads-up Complex and Simple share the same table size, so every HU id
includes the variant (`complex` or `simple`) even when their depths do not
currently overlap.

## JSON schema

Top level:

```text
{
  format: "holdem-lab.spots",
  version: 1,
  source: "GTO Wizard (hand-read, personal study)",
  extracted: "2026-11-23",
  libraries: { "Cash6m50zGeneral": { players, rake, variant, sizing, opening, cold_calls, postflop, depths, n_spots }, ... },
  gametypes: ["Cash6m50zGeneral", "CashHu500zComplex", ...],
  spots: [ ... ]
}
```

Each spot:

```text
{
  id, gametype, players, rake, variant, depth,
  spot_type,          // rfi | vsOpen | vs3bet | vs4bet | vsLimpRaise
  hero, villain,      // villain is null on rfi
  action_path,        // GTO Wizard preflop_actions string
  sizes: { raise, raise2?, raise3?, allin? },   // bb
  overall: { fold, call, raise, raise2, raise3, allin },   // header, 0–100
  overall_computed: { ... },           // combo-weighted from the hands
  hands: { "AKs": { weight, fold, call, raise, raise2, raise3, allin }, ... all 169 }
}
```

Optional fields: `url`, `source_file`, `note`, `variant`, `weight_rescale`,
`unlisted`, `weight_unit_detected`, `combos_reaching`.

Frequencies and weights are stored as **percentages (0–100)**, not 0–1. The
app's import format uses 0–1; divide by 100 if you paste these into Hold'em Lab.

## Letters and weights in the raw files

| Letter | Meaning | JSON field |
| --- | --- | --- |
| `F` | Fold | `fold` |
| `C` | Call, check, or (SB first-in) limp | `call` |
| `R` or `R1=` | Raise, or the smallest raise when several sizes exist | `raise` |
| `R2=` | The next-larger raise | `raise2` |
| `R3=` | A third, still larger raise (heads-up limp-and-raise lines) | `raise3` |
| `A` | All-in | `allin` |

A bare letter means 100%% of that action (`AA:R` or `T9s:A`). Numbers are percents
(`AKs:R45/C55`, `K6s:A24/R71.5/C4.5`). Several-size lines look like
`AA:R2=67.5/R1=32.5` or `AA:R3=21.6/R2=51.8/R1=26.6`. Only `Rn=` (with the
equals sign) is a sized raise; bare `R2` still means raise 2%%. A few
hand-reads use `?` for the larger raise instead of `R2=` (`AA:?44.5/R55.5`).
In the GTO Wizard `action_path` (and the `path` header field) an all-in is the
token `RAI`, e.g. `F-F-F-F-RAI` or `F-F-F-F-C-RAI`. That is a path token only;
hand lines still use the letter `A`.

`[N]` is the range weight: the share of that hand's combos that reach the node.
Omitted `[N]` on a listed hand means 100. Detection: if any `[N]` in the spot
is greater than 1, every `[N]` in that spot is treated as a percent; if every
`[N]` is ≤ 1, they are treated as fractions and converted to percent. Current
files all use percents (including small values such as `[0.8]` for 0.8%%). If a
future file is ambiguous, the overall-frequency check in `VALIDATION.md` will
flag it.

On SB first-in lines, entries are `R` / `C` (limp) and, at short stacks, `A`
(all-in); the remainder is fold.

## Unlisted hands

All 169 hand classes appear in every spot.

- **rfi** and **vsOpen**: a hand not listed is a pure fold (`weight` 100, `fold` 100).
- **vs3bet**, **vs4bet**, **vsLimpRaise**: a hand not listed is out of range (`weight` 0, all actions 0). Those hands are skipped when recomputing overall frequencies.

If fold is not written on a listed hand and the listed actions sum to less than 100, the remainder is filled in as fold.

## Caveats

- **Hand-read precision.** Most charts were typed at about 0.5%% resolution; several first-in matrices (including 20bb, 150bb, 200bb, 8-max and 9-max) were read at 0.1%%. Expect small gaps versus the on-screen overview. `VALIDATION.md` flags any combo-weighted overall that is more than 1 percentage point away from the header, and any in-range hand whose actions do not sum to 100 ± 0.6.
- **Rescaled limp-raise weights.** Headers record a rescale so combo totals match GTO Wizard's overview panel: 6-max 100bb ×0.6357, 40bb ×0.295, 20bb ×0.215 (including the BB shove); HU Complex 40bb ×0.905, 60bb ×0.715, 100bb ×0.965, 150bb ×0.620, and the 60bb vs4bet R9.5-AI node ×0.990. 50bb 6-max limp-raise weights were also rescaled during collection; those headers do not record the factor. 75bb 6-max limp-raise headers do not mention a rescale.
- **9-max branches below 0.5%% were skipped** during extraction, so a rarely mixed raise size may be missing even when a sibling size for the same node is present.
- **HU 100bb and 60bb early files** were typed before per-node mismatch tags were added, so a hand-level tag that later dumps use may be absent there.
- **HU 60bb vs4bet R19 is 0%%** in the parent node (facing a 9.5bb 3-bet, the 19bb 4-bet frequency is 0%%). The child chart `v4:BB:SB:R9.5:R19` was still extracted.
- **75bb SB open size.** The 6-max 75bb SB first-in raise size was not confirmed on the matrix and is stored as 3bb (`Raise ~3` in the raw header).
- **No SB limp at 6-max 150bb and 200bb.** Those depths have no limp option (raise or fold only). The SB-limp and limp-raise spots are therefore absent, so vsOpen counts 15 rather than 16 and vsLimpRaise is empty.
- **20bb 6-max SB.** The small blind can limp, raise or open-shove. Facing the shove is `vs:BB:SB:allin`. After a limp, the big blind can raise or shove; the shove line is `vl:SB:BB:AI`.
- **8-max (Cash8mLiveGeneral_8mcEVR2).** cEV rake, 2x opens, Single Size postflop trees with cold calls. Recorded in `libraries` and on each spot (`rake`, `opening`, `cold_calls`, `postflop`).
- GTO Wizard licenses its solutions and blocks bulk scraping. Do not fetch charts automatically; only add files that were typed by hand.

## Combo weights used in validation

Pairs 6, suited 4, offsuit 12, multiplied by `weight/100`. Overall action frequency is the share of those reaching combos that take the action.
""" % {
        "n_files": n_files,
        "n_spots": n_spots,
        "skipped": skipped,
        "depths": ", ".join("%sbb" % d for d in depths) if depths else "(none)",
        "coverage": coverage,
        "lib_table": lib_table,
    }


def render_validation(validations, warnings, n_files, n_spots, by_depth_type):
    flagged = [v for v in validations if v["flagged"]]
    kinds = defaultdict(int)
    for v in flagged:
        seen = set()
        for iss in v["issues"]:
            seen.add(iss["kind"])
        for k in seen:
            kinds[k] += 1

    lines = []
    a = lines.append
    a("# Validation report")
    a("")
    a("Generated by `build.py` against the current `raw/` files.")
    a("")
    a("- Raw files parsed: **%s**" % n_files)
    a("- Spots emitted: **%s**" % n_spots)
    a("- Spots flagged: **%s**" % len(flagged))
    a("- File-level warnings: **%s**" % len(warnings))
    a("")
    a("Flags are: overall combo-weighted frequency more than 1 percentage point from the header; an in-range hand whose fold+call+raise+raise2+raise3+allin is outside 100 ± 0.6; an unparseable token; a duplicate hand.")
    a("")
    a("## Spots per depth and type")
    a("")
    types = ["rfi", "vsOpen", "vs3bet", "vs4bet", "vsLimpRaise"]
    keys = sorted(by_depth_type, key=lambda k: (
        k[0] if isinstance(k[0], int) else 99, k[1], k[2]
    ))
    multi = len({(k[0], k[1]) for k in keys}) > 1
    if multi:
        a("| Players | Gametype | Depth | " + " | ".join(types) + " | Total |")
        a("| --- | --- | --- | " + " | ".join("---" for _ in types) + " | --- |")
    else:
        a("| Depth | " + " | ".join(types) + " | Total |")
        a("| --- | " + " | ".join("---" for _ in types) + " | --- |")
    for key in keys:
        players, gametype, depth = key
        counts = by_depth_type[key]
        total = 0
        nums = []
        for t in types:
            n = counts.get(t, 0)
            total += n
            nums.append(str(n) if n else "—")
        if multi:
            row = [str(players), gametype, "%sbb" % depth] + nums + [str(total)]
        else:
            row = ["%sbb" % depth] + nums + [str(total)]
        a("| " + " | ".join(row) + " |")
    a("")
    a("## Summary")
    a("")
    a("| Check | Spots flagged |")
    a("| --- | --- |")
    a("| Overall gap > 1pp | %s |" % kinds.get("overall_gap", 0))
    a("| Action sum outside 100±0.6 | %s |" % kinds.get("action_sum", 0))
    a("| Unparseable tokens | %s |" % kinds.get("unparseable", 0))
    a("| Duplicate hands | %s |" % kinds.get("duplicate", 0))
    a("")

    if warnings:
        a("## File-level warnings")
        a("")
        for w in warnings:
            a("- %s" % w)
        a("")

    a("## Flagged spots")
    a("")
    if not flagged:
        a("None. Every spot is within the overall 1pp tolerance, every in-range hand sums to 100 ± 0.6, and no unparseable or duplicate tokens were found.")
        a("")
    else:
        for v in flagged:
            a("### `%s`" % v["id"])
            a("")
            a("- Source: `%s`" % v["source_file"])
            a("- Listed hands: %s · combos reaching: %s · max overall gap: %s pp" % (
                v["n_listed"], v["combos_reaching"], v["max_gap_pp"]))
            hdr = v["header_overall"]
            cmp_ = v["computed_overall"]
            def _ov(d):
                return ", ".join("%s %s" % (k, d.get(k, 0)) for k in ACTIONS)
            a("- Header overall: %s" % _ov(hdr))
            a("- Computed overall: %s" % _ov(cmp_))
            a("")
            for iss in v["issues"]:
                a("- **%s**: %s" % (iss["kind"], iss["message"]))
            a("")

    a("## All spots")
    a("")
    a("| Id | Listed | Combos | Max Δ pp | Status |")
    a("| --- | --- | --- | --- | --- |")
    for v in validations:
        status = "FLAGGED" if v["flagged"] else "ok"
        a("| `%s` | %s | %s | %s | %s |" % (
            v["id"], v["n_listed"], v["combos_reaching"], v["max_gap_pp"], status))
    a("")
    return "\n".join(lines)


def strip_internal_fields(spot):
    """Keep overall_computed in the JSON (useful for reuse); nothing else to strip."""
    return spot


class CompactJSONEncoder(json.JSONEncoder):
    def iterencode(self, o, _one_shot=False):
        for chunk in super().iterencode(o, _one_shot=_one_shot):
            yield chunk

    def default(self, o):
        return super().default(o)


def encode_json(obj):
    # json.dumps already uses our clean_number ints/floats.
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw", default=None, help="directory of raw .txt files (default: <root>/raw)")
    ap.add_argument("--out", default=None, help="output directory (default: <root>/dataset)")
    ap.add_argument("--root", default=None, help="dataset root (default: directory of this script)")
    ap.add_argument("--web", default=None, help="also write the compact app bundle (data/gtow/app) here")
    args = ap.parse_args(argv)

    root = args.root or os.path.dirname(os.path.abspath(__file__))
    raw_dir = args.raw or os.path.join(root, "raw")
    out_dir = args.out or os.path.join(root, "dataset")
    csv_dir = os.path.join(out_dir, "csv")

    if not os.path.isdir(raw_dir):
        sys.stderr.write("raw directory not found: %s\n" % raw_dir)
        return 1

    files = sorted(
        os.path.join(raw_dir, n)
        for n in os.listdir(raw_dir)
        if n.endswith(".txt") and not n.startswith(".")
    )
    manifest = load_manifest(raw_dir)
    known_gametypes = sorted({
        row.get("gametype") for row in manifest.values() if row.get("gametype")
    } | set(KNOWN_LIBRARIES), key=len, reverse=True)

    spots = []
    validations = []
    warnings = []
    parsed_files = 0
    skipped_files = []
    for path in files:
        results, warns = parse_raw_file(
            path, manifest=manifest, known_gametypes=known_gametypes,
        )
        warnings.extend(warns)
        if results:
            parsed_files += 1
        else:
            skipped_files.append((os.path.basename(path), list(warns)))
        for spot, val in results:
            spots.append(spot)
            validations.append(val)

    spots.sort(key=sort_key)
    order = {s["id"]: i for i, s in enumerate(spots)}
    validations.sort(key=lambda v: order.get(v["id"], 10**9))

    os.makedirs(csv_dir, exist_ok=True)
    # Drop stale CSVs from spots that disappeared since the last run.
    for name in os.listdir(csv_dir):
        if name.endswith(".csv"):
            os.remove(os.path.join(csv_dir, name))
    for spot in spots:
        write_csv(os.path.join(csv_dir, id_safe(spot["id"]) + ".csv"), spot["hands"])

    by = count_table(spots)
    depths = sorted({s["depth"] for s in spots})
    gametypes = sorted({s["gametype"] for s in spots if s.get("gametype")})
    rakes = sorted({s["rake"] for s in spots if s.get("rake")})
    pools = sorted({s.get("pool") for s in spots if s.get("pool")})
    players_set = sorted({s["players"] for s in spots if s.get("players")})
    libraries = build_libraries_meta(spots)

    # Unique-id check (HU variants must not collide).
    id_counts = {}
    for s in spots:
        id_counts[s["id"]] = id_counts.get(s["id"], 0) + 1
    dup_ids = sorted(i for i, n in id_counts.items() if n > 1)
    if dup_ids:
        warnings.append("duplicate spot ids: %s" % ", ".join(dup_ids[:20]))

    doc = OrderedDict()
    doc["format"] = "holdem-lab.spots"
    doc["version"] = 1
    doc["source"] = "GTO Wizard (hand-read, personal study)"
    doc["extracted"] = "2026-11-23"
    doc["libraries"] = libraries
    doc["gametypes"] = gametypes
    if len(gametypes) == 1:
        doc["gametype"] = gametypes[0]
    if rakes:
        doc["rake"] = rakes[0] if len(rakes) == 1 else rakes
    if pools:
        doc["pool"] = pools[0] if len(pools) == 1 else pools
    if players_set:
        doc["players"] = players_set[0] if len(players_set) == 1 else players_set
    doc["n_spots"] = len(spots)
    doc["n_raw_files"] = parsed_files
    doc["n_skipped"] = len(skipped_files)
    doc["spots"] = [strip_internal_fields(s) for s in spots]

    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, "gtow-cash.json")
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(encode_json(doc))

    app_dir = os.path.join(out_dir, "app")
    app_written = write_app_bundle(app_dir, doc, spots)

    readme_path = os.path.join(out_dir, "README.md")
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(render_readme(
            parsed_files, len(spots), depths, by=by, libraries=libraries,
            skipped=len(skipped_files),
        ))

    val_path = os.path.join(out_dir, "VALIDATION.md")
    with open(val_path, "w", encoding="utf-8") as f:
        f.write(render_validation(validations, warnings, parsed_files, len(spots), by))

    # Console summary for the operator / parent agent.
    print("Parsed %s raw files → %s spots" % (parsed_files, len(spots)))
    types = ["rfi", "vsOpen", "vs3bet", "vs4bet", "vsLimpRaise"]
    keys = sorted(by, key=lambda k: (k[0] if isinstance(k[0], int) else 99, k[1], k[2]))
    multi = len({(k[0], k[1]) for k in keys}) > 1
    if multi:
        print("players  gametype                      depth  " + "  ".join("%-13s" % t for t in types) + "  total")
    else:
        print("Depth  " + "  ".join("%-13s" % t for t in types) + "  total")
    for key in keys:
        players, gametype, depth = key
        parts = []
        total = 0
        for t in types:
            n = by[key].get(t, 0)
            total += n
            parts.append("%-13s" % n)
        if multi:
            print("%7s  %-28s %4sbb  %s  %s" % (players, gametype, depth, "  ".join(parts), total))
        else:
            print("%4sbb  %s  %s" % (depth, "  ".join(parts), total))
    flagged = [v for v in validations if v["flagged"]]
    print("Flagged spots: %s / %s" % (len(flagged), len(spots)))
    for v in flagged:
        print("  FLAG %s  maxΔ=%s pp  (%s)" % (v["id"], v["max_gap_pp"], v["source_file"]))
        for iss in v["issues"]:
            print("       - %s: %s" % (iss["kind"], iss["message"]))
    print("Skipped files: %s / %s" % (len(skipped_files), len(files)))
    for name, warns in skipped_files:
        print("  SKIP %s" % name)
        for w in warns:
            print("       - %s" % w)
    if dup_ids:
        print("Duplicate ids (%s):" % len(dup_ids))
        for i in dup_ids[:30]:
            print("  DUP %s" % i)
    if warnings:
        print("Warnings:")
        for w in warnings:
            print("  %s" % w)
    def _sz(path):
        try:
            n = os.path.getsize(path)
        except OSError:
            return "?"
        if n >= 1024 * 1024:
            return "%.1fM" % (n / (1024 * 1024.0))
        if n >= 1024:
            return "%.0fK" % (n / 1024.0)
        return "%sB" % n
    print("Wrote:")
    print("  %s (%s)" % (json_path, _sz(json_path)))
    print("  %s" % readme_path)
    print("  %s" % val_path)
    print("  %s (%s csv files)" % (csv_dir, len(spots)))
    for ap in app_written:
        print("  %s (%s)" % (ap, _sz(ap)))
    if args.web:
        from pack_app import write_web
        n_web, gap, gid = write_web(app_dir, args.web)
        print("  %s (%s compact spots, max header gap %.4f pp, %s)" % (args.web, n_web, gap, gid))
    return 0 if not warnings and not skipped_files and not dup_ids else 0


if __name__ == "__main__":
    sys.exit(main())
