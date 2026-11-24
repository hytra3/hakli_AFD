#!/usr/bin/env python3
"""
sheet_to_words.py — turn the glossing Sheet into afd-words.js entries.

The glossing workbook (one tab per notebook page) is the authoring surface:
Hannan fills the Arabic gloss, Fatma confirms the Hakli. git stays the source
of truth, so this script bakes the *confirmed* rows of a tab into afd-words.js;
`seed-entries.mjs` then writes them to Firestore. The app never reads the Sheet.

Download the workbook from Google Sheets as .xlsx (File -> Download -> Microsoft
Excel), then:

    python scripts/sheet_to_words.py glossing.xlsx                 # dry run, prints entries
    python scripts/sheet_to_words.py glossing.xlsx --tab "1 · Body parts"
    python scripts/sheet_to_words.py glossing.xlsx --tab "1 · Body parts" --apply

Only run --apply on a tab once Fatma/Hannan have confirmed it. The script is
idempotent: a word whose id is already in afd-words.js is left untouched (so an
in-app edit is never clobbered — the editedAt guard in seed-entries covers the
Firestore side).

Expected columns (by header, any order): "English (meaning)", "Arabic gloss",
"Hakli — as written", "Hakli plural". A row is imported only if it has a gloss
(English or Arabic); its Hakli goes to spellCand (a review-only candidate, never
the bold word — decision D-B). Needs openpyxl (pip install openpyxl).
"""
import argparse, re, sys, unicodedata
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required: pip install openpyxl")

HEADERS = {
    "english (meaning)": "en",
    "english": "en",
    "arabic gloss": "ar",
    "hakli — as written": "spellCand",
    "hakli - as written": "spellCand",
    "hakli plural": "spellCandPl",
}
# Tab name -> domain slug. Anything not listed is slugged from the tab name.
DOMAIN = {
    "1 · body parts": "body",
    "2 · land & water": "water",
    "3 · landforms": "landform",
}

def slug(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s

def page_slug(tab):
    return slug(re.sub(r"^\s*\d+\s*·\s*", "", tab)) or slug(tab)

def domain_for(tab):
    return DOMAIN.get(tab.strip().lower(), page_slug(tab))

def js_entry(e):
    # compact, matching afd-words.js style: {id:"x",en:"y",...}
    order = ["id", "en", "ar", "pic", "dom", "ref", "spellCand", "spellCandPl", "src"]
    parts = []
    for k in order:
        v = e.get(k)
        if v:
            parts.append(f'{k}:{js_str(v)}')
    return "{" + ",".join(parts) + "}"

def js_str(v):
    return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'

def read_tab(ws, tab):
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    header = [str(c).strip().lower() if c else "" for c in rows[0]]
    col = {HEADERS[h]: i for i, h in enumerate(header) if h in HEADERS}
    if "en" not in col and "ar" not in col:
        return []
    dom, src = domain_for(tab), "nb:" + page_slug(tab)
    out, rownum = [], 0
    for r in rows[1:]:
        rownum += 1
        def cell(key):
            i = col.get(key)
            return str(r[i]).strip() if (i is not None and i < len(r) and r[i] not in (None, "")) else ""
        en, ar = cell("en"), cell("ar")
        if not en and not ar:
            continue  # no gloss yet — not ready
        wid = slug(en) if en else f"{page_slug(tab)}-{rownum:02d}"
        e = {"id": wid, "en": en, "ar": ar, "dom": dom, "src": src}
        if cell("spellCand"):   e["spellCand"] = cell("spellCand")
        if cell("spellCandPl"): e["spellCandPl"] = cell("spellCandPl")
        out.append(e)
    return out

def existing_ids(words_js):
    return set(re.findall(r'\bid:"([^"]+)"', words_js))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--tab", help="only this tab (default: all tabs except 'How to use')")
    ap.add_argument("--apply", action="store_true", help="write into afd-words.js")
    ap.add_argument("--words", default=str(Path(__file__).resolve().parent.parent / "afd-words.js"))
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.xlsx, read_only=True, data_only=True)
    tabs = [args.tab] if args.tab else [t for t in wb.sheetnames if t.strip().lower() != "how to use"]

    words_js = Path(args.words).read_text(encoding="utf-8")
    have = existing_ids(words_js)

    entries, skipped = [], 0
    for tab in tabs:
        if tab not in wb.sheetnames:
            sys.exit(f"no such tab: {tab!r}; tabs are {wb.sheetnames}")
        for e in read_tab(wb[tab], tab):
            if e["id"] in have or any(x["id"] == e["id"] for x in entries):
                skipped += 1
                continue
            entries.append(e)

    print(f"{len(entries)} new entr{'y' if len(entries)==1 else 'ies'}"
          f" from {len(tabs)} tab(s); {skipped} already present / duplicate.")
    for e in entries:
        print("  " + js_entry(e))

    if not args.apply:
        print("\nDry run. Re-run with --apply to write them into afd-words.js.")
        return
    if not entries:
        print("Nothing to add.")
        return
    body = "\n".join(" " + js_entry(e) + "," for e in entries)
    # insert after the last entry's closing brace, before the array's `];`,
    # normalising the separator so it works whether or not the file keeps a
    # trailing comma on its last entry.
    new_js, n = re.subn(r"\}\s*,?\s*\n\s*\];", "},\n" + body + "\n];", words_js, count=1)
    if n != 1:
        sys.exit("could not find the end of the AFDWords array in afd-words.js")
    Path(args.words).write_text(new_js, encoding="utf-8")
    print(f"\nWrote {len(entries)} entries into {args.words}. "
          f"Review the diff, bump the ?v= on afd-words.js, then run seed-entries.mjs.")

if __name__ == "__main__":
    main()
