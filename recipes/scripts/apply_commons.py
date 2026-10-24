#!/usr/bin/env python3
"""Apply a match_commons.py proposal: download each matched photo and rewrite
the recipe's image block.

Matched recipes get their OWN file, named after the recipe slug, so variants of
one dish no longer share a single photo. Unmatched recipes keep the Wikipedia
lead image they already have and are marked match="representative" so the UI can
caption or de-emphasise them.
"""
import argparse, json, pathlib, sys
from fetch_images import session, polite_get

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA, IMAGES = ROOT / "data", ROOT / "images"


def strip_html(v):
    import re
    return re.sub(r"<[^>]+>", "", v or "").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proposal", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    prop = json.load(open(args.proposal))
    by_id = {h["id"]: h for h in prop["hits"]}
    s = session()
    attr_path = IMAGES / "attribution.json"
    attr = json.load(open(attr_path)) if attr_path.exists() else {}

    saved = failed = 0
    for i, h in enumerate(prop["hits"], 1):
        dest = IMAGES / f"{h['slug']}.jpg"
        if dest.exists():
            continue
        if args.dry_run:
            print(f"[{i}] would save {dest.name} <- {h['commons']['title']}")
            continue
        try:
            r = polite_get(s, h["commons"]["thumb"])
            dest.write_bytes(r.content)
            m = h["commons"]["meta"]
            attr[dest.name] = {
                "source": "wikimedia-commons",
                "commons_file": h["commons"]["title"],
                "file_page": "https://commons.wikimedia.org/wiki/File:"
                             + h["commons"]["title"].replace(" ", "_"),
                "artist": strip_html(m.get("Artist")),
                "licence": strip_html(m.get("LicenseShortName")),
                "credit": strip_html(m.get("Attribution") or m.get("Credit")),
            }
            saved += 1
            print(f"[{i}/{len(prop['hits'])}] {dest.name} <- "
                  f"{h['commons']['title'][:50]}", flush=True)
        except Exception as e:
            failed += 1
            print(f"[{i}] FAIL {h['slug']}: {e}", flush=True)
            by_id.pop(h["id"], None)

    if args.dry_run:
        return 0
    json.dump(attr, open(attr_path, "w"), indent=1, ensure_ascii=False)

    changed = 0
    for p in sorted(DATA.rglob("*.json")):
        recs = json.load(open(p))
        for r in recs:
            h = by_id.get(r["id"])
            if h and (IMAGES / f"{r['slug']}.jpg").exists():
                r["image"] = {"file": f"{r['slug']}.jpg",
                              "source": "commons-file",
                              "match": "dish",
                              "commonsFile": h["commons"]["title"]}
                changed += 1
            elif "wikipedia" in r["image"]:
                r["image"] = {"file": r["image"]["file"],
                              "source": "wikipedia-lead",
                              "match": "representative",
                              "wikipedia": r["image"]["wikipedia"]}
        json.dump(recs, open(p, "w"), indent=1, ensure_ascii=False)
    print(f"\nsaved {saved} photos, {failed} failed; "
          f"{changed} recipes now have a dish-specific image")
    return 0


if __name__ == "__main__":
    sys.exit(main())
