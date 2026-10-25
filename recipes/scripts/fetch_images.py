#!/usr/bin/env python3
"""Download medium-resolution dish images from Wikipedia for every recipe.

For each distinct (image.file, image.wikipedia) pair in data/*.json this script
asks the English Wikipedia API for the page's lead image, downloads it at
~800px wide as JPEG into images/, and records licensing metadata in
images/attribution.json.

Wikipedia images are NOT public domain by default. Most are CC BY-SA and
require crediting the photographer. attribution.json carries the author,
licence and file page for every image so the UI can display a credit line.

Usage:
    python3 scripts/fetch_images.py              # fetch anything missing
    python3 scripts/fetch_images.py --force      # re-fetch everything
    python3 scripts/fetch_images.py --dry-run    # resolve only, report misses
    python3 scripts/fetch_images.py --only cheeseburger.jpg
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMAGES = ROOT / "images"
ATTRIBUTION = IMAGES / "attribution.json"

API = "https://en.wikipedia.org/w/api.php"
# Wikimedia requires a descriptive User-Agent with contact info.
UA = "GusteauRecipeBot/1.0 (https://github.com/gusteau; jpdodel@gmail.com) requests"
THUMB_WIDTH = 800
SLEEP = 0.7   # be polite to the API; Wikipedia returns 429 if you push harder
MAX_RETRIES = 5


def polite_get(s: requests.Session, url: str, **kwargs) -> requests.Response:
    """GET with backoff on rate limiting. Wikimedia returns 429 under load."""
    delay = 2.0
    for attempt in range(MAX_RETRIES):
        r = s.get(url, **kwargs)
        if r.status_code not in (429, 503):
            r.raise_for_status()
            return r
        wait = float(r.headers.get("Retry-After", delay))
        print(f"    rate limited, waiting {wait:.0f}s (attempt {attempt + 1}/{MAX_RETRIES})")
        time.sleep(wait)
        delay *= 2
    r.raise_for_status()
    return r


def session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = UA
    return s


def load_pairs() -> dict[str, set[str]]:
    """file -> {wikipedia titles that claim it}"""
    pairs: dict[str, set[str]] = {}
    for path in sorted(DATA.rglob("*.json")):
        for recipe in json.loads(path.read_text()):
            img = recipe["image"]
            pairs.setdefault(img["file"], set()).add(img["wikipedia"])
    return pairs


def resolve(s: requests.Session, title: str) -> dict | None:
    """Return lead-image info for a Wikipedia page title, or None."""
    r = polite_get(s, API, params={
        "action": "query", "format": "json", "formatversion": "2",
        "titles": title, "redirects": "1",
        "prop": "pageimages|info", "inprop": "url",
        "piprop": "thumbnail|name", "pithumbsize": THUMB_WIDTH,
    }, timeout=30)
    pages = r.json().get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing") or "thumbnail" not in pages[0]:
        return None
    page = pages[0]
    return {
        "page_title": page["title"],
        "page_url": page.get("fullurl", f"https://en.wikipedia.org/wiki/{quote(title)}"),
        "image_title": "File:" + page.get("pageimage", ""),
        "thumb_url": page["thumbnail"]["source"],
        "width": page["thumbnail"].get("width"),
        "height": page["thumbnail"].get("height"),
    }


def licence(s: requests.Session, image_title: str) -> dict:
    """Author / licence / file-page for a File: title."""
    if image_title == "File:":
        return {}
    r = polite_get(s, API, params={
        "action": "query", "format": "json", "formatversion": "2",
        "titles": image_title, "prop": "imageinfo",
        "iiprop": "extmetadata|url", "iiextmetadatafilter":
            "Artist|LicenseShortName|License|Credit|UsageTerms|AttributionRequired",
    }, timeout=30)
    pages = r.json().get("query", {}).get("pages", [])
    if not pages or "imageinfo" not in pages[0]:
        return {}
    info = pages[0]["imageinfo"][0]
    meta = info.get("extmetadata", {})

    def field(key: str) -> str:
        raw = meta.get(key, {}).get("value", "")
        # extmetadata values can contain HTML; strip tags crudely.
        out, depth = [], 0
        for ch in raw:
            if ch == "<":
                depth += 1
            elif ch == ">":
                depth = max(0, depth - 1)
            elif depth == 0:
                out.append(ch)
        return " ".join("".join(out).split())

    return {
        "artist": field("Artist"),
        "license": field("LicenseShortName") or field("UsageTerms"),
        "credit": field("Credit"),
        "attribution_required": meta.get("AttributionRequired", {}).get("value") == "true",
        "file_page": info.get("descriptionurl", ""),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download existing images")
    ap.add_argument("--dry-run", action="store_true", help="resolve only, download nothing")
    ap.add_argument("--only", help="limit to one image filename")
    args = ap.parse_args()

    IMAGES.mkdir(exist_ok=True)
    pairs = load_pairs()
    if args.only:
        pairs = {k: v for k, v in pairs.items() if k == args.only}
        if not pairs:
            print(f"no recipe references {args.only}", file=sys.stderr)
            return 1

    attribution = json.loads(ATTRIBUTION.read_text()) if ATTRIBUTION.exists() else {}
    s = session()
    fetched = skipped = failed = 0
    misses: list[tuple[str, str]] = []

    for i, (filename, titles) in enumerate(sorted(pairs.items()), 1):
        title = sorted(titles)[0]
        if len(titles) > 1:
            print(f"  ! {filename} claimed by several pages {sorted(titles)}; using {title!r}")
        dest = IMAGES / filename
        if dest.exists() and not args.force:
            skipped += 1
            continue

        print(f"[{i}/{len(pairs)}] {filename}  <-  {title}")
        try:
            found = resolve(s, title)
        except requests.RequestException as exc:
            print(f"    network error: {exc}")
            failed += 1
            continue
        if not found:
            print("    NO LEAD IMAGE — fix the image.wikipedia title for this recipe")
            misses.append((filename, title))
            failed += 1
            continue

        meta = licence(s, found["image_title"])
        if args.dry_run:
            print(f"    ok {found['thumb_url']}  [{meta.get('license', '?')}]")
            fetched += 1
            time.sleep(SLEEP)
            continue

        try:
            img = polite_get(s, found["thumb_url"], timeout=60)
            dest.write_bytes(img.content)
        except requests.RequestException as exc:
            print(f"    download failed: {exc}")
            failed += 1
            continue

        attribution[filename] = {
            "wikipedia_page": found["page_title"],
            "page_url": found["page_url"],
            "image_file": found["image_title"],
            "file_page": meta.get("file_page", ""),
            "artist": meta.get("artist", ""),
            "license": meta.get("license", ""),
            "credit": meta.get("credit", ""),
            "attribution_required": meta.get("attribution_required", True),
            "source_url": found["thumb_url"],
            "width": found["width"],
            "height": found["height"],
            "bytes": len(img.content),
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        print(f"    saved {len(img.content) // 1024} KB  [{meta.get('license', '?')}]")
        fetched += 1
        time.sleep(SLEEP)

    if not args.dry_run:
        ATTRIBUTION.write_text(json.dumps(dict(sorted(attribution.items())), indent=2) + "\n")

    print(f"\nfetched {fetched}, already present {skipped}, failed {failed}")
    if misses:
        print("\nPages with no lead image (edit image.wikipedia in data/*.json):")
        for filename, title in misses:
            print(f"  {filename}: {title!r}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
