#!/usr/bin/env python3
"""Download chef profile photos from Wikipedia into images/chefs/.

Reads chefs.json, resolves each chef's Wikipedia lead image to a ~500px JPEG
and records licensing metadata in images/chefs/attribution.json.

Photographs of living people on Wikipedia are usually CC BY-SA and REQUIRE a
visible credit. attribution.json carries the photographer and licence for each
one - display it wherever the face is shown.

Usage:
    python3 scripts/fetch_chef_images.py
    python3 scripts/fetch_chef_images.py --force
    python3 scripts/fetch_chef_images.py --only rick-bayless
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_images import licence, resolve, session  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CHEFS = ROOT / "chefs.json"
OUT = ROOT / "images" / "chefs"
ATTRIBUTION = OUT / "attribution.json"
PORTRAIT_WIDTH = 500


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", help="limit to one chef slug")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    chefs = json.loads(CHEFS.read_text())["chefs"]
    if args.only:
        chefs = [c for c in chefs if c["slug"] == args.only]
        if not chefs:
            print(f"no chef with slug {args.only}", file=sys.stderr)
            return 1

    attribution = json.loads(ATTRIBUTION.read_text()) if ATTRIBUTION.exists() else {}
    s = session()
    fetched = skipped = failed = 0

    for i, chef in enumerate(chefs, 1):
        dest = OUT / chef["image"]
        if dest.exists() and not args.force:
            skipped += 1
            continue

        print(f"[{i}/{len(chefs)}] {chef['name']}")
        try:
            # resolve() asks for a thumbnail; portraits look better narrower.
            found = resolve(s, chef["wikipedia"])
        except Exception as exc:
            print(f"    error: {exc}")
            failed += 1
            continue
        if not found:
            print("    NO LEAD IMAGE - this chef's page may have no free photo")
            failed += 1
            continue

        url = found["thumb_url"]
        # Rewrite the width in the thumbnail URL to a portrait-friendly size.
        if f"/{found['width']}px-" in url and found["width"]:
            url = url.replace(f"/{found['width']}px-", f"/{PORTRAIT_WIDTH}px-")

        meta = licence(s, found["image_title"])
        try:
            img = s.get(url, timeout=60)
            img.raise_for_status()
            dest.write_bytes(img.content)
        except Exception as exc:
            print(f"    download failed: {exc}")
            failed += 1
            continue

        attribution[chef["image"]] = {
            "chef": chef["name"],
            "slug": chef["slug"],
            "wikipedia_page": found["page_title"],
            "page_url": found["page_url"],
            "image_file": found["image_title"],
            "file_page": meta.get("file_page", ""),
            "artist": meta.get("artist", ""),
            "license": meta.get("license", ""),
            "credit": meta.get("credit", ""),
            "attribution_required": meta.get("attribution_required", True),
            "source_url": url,
            "bytes": len(img.content),
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        print(f"    saved {len(img.content) // 1024} KB  [{meta.get('license', '?')}]")
        fetched += 1
        time.sleep(0.2)

    ATTRIBUTION.write_text(json.dumps(dict(sorted(attribution.items())), indent=2) + "\n")
    print(f"\nfetched {fetched}, already present {skipped}, failed {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
