#!/usr/bin/env python3
"""Repair dish-match records whose image file is still the old Wikipedia lead.

apply_commons.py skipped the download when images/<slug>.jpg already existed, which
happens whenever a recipe slug coincides with a legacy generic filename (gazpacho ->
gazpacho.jpg). Those records ended up labelled commons-file while the bytes on disk
were still the Wikipedia lead image.

A legacy filename cannot simply be overwritten: other recipes may still point at it on
the representative tier. So the dish match is written to <slug>-dish.jpg instead, and
any legacy file left referenced by nobody is pruned.
"""
import argparse, json, pathlib, re, sys
from fetch_images import session, polite_get

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA, IMAGES = ROOT / "data", ROOT / "images"


def strip_html(v):
    return re.sub(r"<[^>]+>", "", v or "").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proposal", required=True)
    args = ap.parse_args()

    hits = {h["id"]: h for h in json.load(open(args.proposal))["hits"]}
    attr = json.load(open(IMAGES / "attribution.json"))
    files = [(p, json.load(open(p))) for p in sorted(DATA.rglob("*.json"))]

    broken = []
    for _, recs in files:
        for r in recs:
            img = r["image"]
            if img.get("match") != "dish":
                continue
            a = attr.get(img["file"], {})
            if a.get("commons_file") != img.get("commonsFile"):
                broken.append(r)
    print(f"{len(broken)} dish records still showing a Wikipedia lead image")

    s = session()
    saved = 0
    for i, r in enumerate(broken, 1):
        h = hits.get(r["id"])
        if not h:
            continue
        name = f"{r['slug']}-dish.jpg"
        dest = IMAGES / name
        try:
            resp = polite_get(s, h["commons"]["thumb"])
            dest.write_bytes(resp.content)
        except Exception as e:
            print(f"[{i}] FAIL {r['slug']}: {e}", flush=True)
            continue
        m = h["commons"]["meta"]
        attr[name] = {
            "source": "wikimedia-commons",
            "commons_file": h["commons"]["title"],
            "file_page": "https://commons.wikimedia.org/wiki/File:"
                         + h["commons"]["title"].replace(" ", "_"),
            "artist": strip_html(m.get("Artist")),
            "licence": strip_html(m.get("LicenseShortName")),
            "credit": strip_html(m.get("Attribution") or m.get("Credit")),
        }
        r["image"]["file"] = name
        saved += 1
        print(f"[{i}/{len(broken)}] {name} <- {h['commons']['title'][:48]}", flush=True)

    for p, recs in files:
        json.dump(recs, open(p, "w"), indent=1, ensure_ascii=False)

    # Prune image files and attribution entries nothing points at any more.
    used = {r["image"]["file"] for _, recs in files for r in recs}
    used |= {f"chefs/{n}" for n in ()}
    orphans = [f for f in IMAGES.glob("*.jpg") if f.name not in used]
    for f in orphans:
        f.unlink()
        attr.pop(f.name, None)
    for key in [k for k in attr if k not in used]:
        attr.pop(key)
    json.dump(attr, open(IMAGES / "attribution.json", "w"), indent=1,
              ensure_ascii=False)
    print(f"\nrepaired {saved} records, pruned {len(orphans)} orphaned images")
    return 0


if __name__ == "__main__":
    sys.exit(main())
