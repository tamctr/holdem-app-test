#!/usr/bin/env python3
"""Pack dataset/app/*.json into the compact bundle Hold'em Lab lazy-loads.

The full app JSON is about 15MB because every spot stores all 169 hands
with every action. The site only needs one gametype at a time, and most
hands are a pure fold, so the bundle stores just the exceptions:

    AA:R                 100% raise
    AKs:R45/C55          mixed
    76s@12.5:F80/R20     weight 12.5% of combos reach, then 80/20

Run after build.py:

    python3 pack_app.py --src dataset/app --out app

Or `python3 build.py --web app`. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import re

ACTS = (
    ("fold", "F"),
    ("call", "C"),
    ("raise", "R"),
    ("raise2", "S"),
    ("raise3", "T"),
    ("allin", "A"),
)
SIZE_KEYS = (("raise", "R"), ("raise2", "S"), ("raise3", "T"), ("allin", "A"))
EIGHT_RE = re.compile(r"^Cash8mLive(General|Simple)_8m(cEV|LIVE)R(2|25|3|4|5|7)$")
OPEN_LABEL = {"2": "2", "25": "2.5", "3": "3", "4": "4", "5": "5", "7": "7"}


def trim(x):
    x = float(x)
    if abs(x) < 5e-4:
        return "0"
    if abs(x - round(x)) < 5e-4:
        return str(int(round(x)))
    s = ("%.4f" % x).rstrip("0").rstrip(".")
    return s


def combos(hand):
    if len(hand) == 2:
        return 6
    return 4 if hand.endswith("s") else 12


def pack_hands(spot):
    later = spot["spot_type"] in ("vs3bet", "vs4bet", "vsLimpRaise")
    bits = []
    for hand, cell in spot["hands"].items():
        weight = float(cell.get("weight") or 0)
        if later and weight <= 0.05:
            continue
        parts = []
        for key, code in ACTS:
            v = float(cell.get(key) or 0)
            if v > 0.05:
                parts.append((code, v))
        if not later and (not parts or (len(parts) == 1 and parts[0][0] == "F")):
            continue
        if len(parts) == 1 and parts[0][1] >= 99.95:
            body = parts[0][0]
        elif not parts:
            body = "F"
        else:
            body = "/".join(c if v >= 99.95 else c + trim(v) for c, v in parts)
        if later and weight < 99.95:
            bits.append("%s@%s:%s" % (hand, trim(weight), body))
        else:
            bits.append("%s:%s" % (hand, body))
    return ",".join(bits)


def pack_spot(spot):
    out = {"id": spot["id"], "x": pack_hands(spot)}
    sz = {}
    for key, code in SIZE_KEYS:
        v = (spot.get("sizes") or {}).get(key)
        if v:
            sz[code] = v if isinstance(v, int) else float(v)
    if sz:
        out["sz"] = sz
    ov = {}
    for key, code in ACTS:
        v = float((spot.get("overall") or {}).get(key) or 0)
        if v > 0.05:
            ov[code] = v if abs(v - round(v)) > 5e-4 else int(round(v))
    if ov:
        out["ov"] = ov
    note = spot.get("note") or ""
    if "0.1%" in note:
        out["p"] = 0.1
    elif "0.5%" in note:
        out["p"] = 0.5
    if "unconfirmed" in note:
        out["su"] = 1
    if spot.get("weight_rescale"):
        out["w"] = spot["weight_rescale"]
    return out


def eight_fields(gametype, lib):
    m = EIGHT_RE.match(gametype)
    if not m:
        return {}
    variant = (lib or {}).get("variant") or ""
    return {
        "pool": m.group(1),
        "rake": "cEV" if m.group(2) == "cEV" else "LIVE",
        "open": OPEN_LABEL[m.group(3)],
        "coldCalls": variant == "2x-coldcalls",
    }


def library_meta(gametype, lib, spots):
    depths = sorted({int(s["depth"]) for s in spots})
    meta = {
        "file": gametype + ".json",
        "players": int(lib.get("players") or spots[0]["players"]),
        "rake": lib.get("rake"),
        "variant": lib.get("variant"),
        "pool": lib.get("pool") or lib.get("variant"),
        "opening": lib.get("opening"),
        "coldCalls": bool(lib.get("cold_calls")),
        "postflop": lib.get("postflop"),
        "label": lib.get("label") or gametype,
        "depths": depths,
        "n": len(spots),
    }
    if lib.get("game"):
        meta["game"] = lib["game"]
    meta.update(eight_fields(gametype, lib))
    if gametype.startswith("Cash8m") and not meta.get("opening") and meta.get("open"):
        meta["opening"] = meta["open"] + "x"
    # Drop nulls so the index stays small, but keep false coldCalls.
    return {k: v for k, v in meta.items() if v is not None}


def write_web(src_dir, out_dir):
    index_path = os.path.join(src_dir, "index.json")
    with open(index_path, encoding="utf-8") as f:
        src_index = json.load(f)
    libraries_in = src_index.get("libraries") or {}
    os.makedirs(out_dir, exist_ok=True)
    libraries = {}
    catalog = {}
    n_spots = 0
    max_gap = 0.0
    worst = None
    for name in sorted(os.listdir(src_dir)):
        if not name.endswith(".json") or name == "index.json":
            continue
        with open(os.path.join(src_dir, name), encoding="utf-8") as f:
            doc = json.load(f)
        gt = doc.get("gametype") or name[:-5]
        spots = doc["spots"]
        packed = [pack_spot(s) for s in spots]
        # Round-trip check against the header, same weighting as build.py.
        gap, gid = _max_gap(spots, packed)
        if gap > max_gap:
            max_gap, worst = gap, gid
        out = {
            "format": "holdem-lab.gtow-pack",
            "version": 1,
            "gametype": gt,
            "spots": packed,
        }
        dest = os.path.join(out_dir, gt + ".json")
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
            f.write("\n")
        lib = libraries_in.get(gt) or {}
        libraries[gt] = library_meta(gt, lib, spots)
        catalog[gt] = [s["id"] for s in spots]
        n_spots += len(spots)
    index = {
        "format": "holdem-lab.gtow-index",
        "version": 1,
        "source": "GTO Wizard (hand-read, personal study)",
        "extracted": src_index.get("extracted") or "2026-11-23",
        "n_spots": n_spots,
        "libraries": libraries,
        "catalog": catalog,
    }
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    if max_gap > 1.2:
        raise SystemExit("pack round-trip gap %.3f pp on %s" % (max_gap, worst))
    return n_spots, max_gap, worst


def _decode_body(body):
    out = {k: 0.0 for k, _ in ACTS}
    if not body:
        return out
    parts = body.split("/")
    bare = None
    for part in parts:
        m = re.match(r"^([FCRSTA])(\d+(?:\.\d+)?)?$", part)
        if not m:
            raise ValueError(body)
        code, num = m.group(1), m.group(2)
        key = {c: k for k, c in ACTS}[code]
        if num is None:
            bare = key
            out[key] = 100.0
        else:
            out[key] = float(num)
    if bare and len(parts) > 1:
        out[bare] = max(0.0, 100.0 - sum(v for k, v in out.items() if k != bare))
    elif sum(out.values()) < 99.5 and out["fold"] == 0:
        out["fold"] = 100.0 - sum(out.values())
    return out


def _max_gap(spots, packed):
    by_id = {p["id"]: p for p in packed}
    worst, gid = 0.0, None
    later_types = {"vs3bet", "vs4bet", "vsLimpRaise"}
    tok_re = re.compile(r"^([2-9TJQKA]{2}[so]?)(?:@(\d+(?:\.\d+)?))?:([A-Z0-9./]+)$")
    for spot in spots:
        packed_spot = by_id[spot["id"]]
        hands = {}
        if packed_spot.get("x"):
            for tok in packed_spot["x"].split(","):
                m = tok_re.match(tok)
                if not m:
                    raise SystemExit("bad token %r in %s" % (tok, spot["id"]))
                cell = _decode_body(m.group(3))
                cell["weight"] = float(m.group(2)) if m.group(2) else 100.0
                hands[m.group(1)] = cell
        later = spot["spot_type"] in later_types
        reach = 0.0
        tot = {k: 0.0 for k, _ in ACTS}
        for hand, src in spot["hands"].items():
            got = hands.get(hand)
            if got is None:
                if later:
                    continue
                got = {"weight": 100, "fold": 100, "call": 0, "raise": 0, "raise2": 0, "raise3": 0, "allin": 0}
            w = got["weight"] / 100.0
            if later and w <= 0:
                continue
            c = combos(hand) * (w if later else 1.0)
            reach += c
            for key, _code in ACTS:
                tot[key] += c * (got[key] / 100.0)
        if reach <= 0:
            continue
        for key, _code in ACTS:
            header = float((spot.get("overall") or {}).get(key) or 0)
            gap = abs(tot[key] / reach * 100.0 - header)
            if gap > worst:
                worst, gid = gap, spot["id"] + " " + key
    return worst, gid


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", required=True, help="dataset/app directory from build.py")
    ap.add_argument("--out", required=True, help="directory for the compact bundle")
    args = ap.parse_args(argv)
    n, gap, gid = write_web(args.src, args.out)
    print("Packed %s spots, max header gap %.4f pp (%s)" % (n, gap, gid))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
