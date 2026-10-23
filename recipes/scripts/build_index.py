#!/usr/bin/env python3
"""Build index.json and facets.json from data/*.json.

index.json  - one slim record per recipe (no steps, no ingredient lines) so the
              browse grid and every filter can run from a single small fetch.
facets.json - the filter vocabulary with counts, for building the filter UI
              without scanning the whole index.

Run after any recipe edit:
    python3 scripts/build_index.py
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMAGES = ROOT / "images"

TIME_BUCKETS = [(0, 15, "under-15"), (16, 30, "15-30"), (31, 60, "30-60"), (61, 10 ** 6, "over-60")]
SPICE_BUCKETS = [(0, 0, "none"), (1, 2, "warm"), (3, 4, "mild"), (5, 6, "medium"), (7, 10, "hot")]


def bucket(value: int, buckets) -> str:
    for low, high, label in buckets:
        if low <= value <= high:
            return label
    return "unknown"


def main() -> int:
    recipes: list[dict] = []
    for path in sorted(DATA.rglob("*.json")):
        recipes += json.loads(path.read_text())
    recipes.sort(key=lambda r: r["id"])

    index = []
    for r in recipes:
        diet = r["diet"]
        index.append({
            "id": r["id"],
            "slug": r["slug"],
            "title": r["title"],
            "genre": r["genre"],
            "chef": (r.get("chef") or {}).get("name"),
            "chefSlug": (r.get("chef") or {}).get("slug"),
            "subgenre": r["subgenre"],
            "description": r["description"],
            "difficulty": r["difficulty"],
            "easeScore": r["easeScore"],
            "spiceScore": r["spiceScore"],
            "spiceBucket": bucket(r["spiceScore"], SPICE_BUCKETS),
            "popularity": r["popularity"],
            "pantryScore": r["pantryScore"],
            "servings": r["servings"],
            "totalMin": r["totalMin"],
            "timeBucket": bucket(r["totalMin"], TIME_BUCKETS),
            "equipment": r["equipment"],
            "ingredientCount": len(r["ingredientKeys"]),
            "specialtyCount": len(r["specialty"]),
            "specialty": r["specialty"],
            "calories": r["nutrition"]["calories"],
            "proteinG": r["nutrition"]["proteinG"],
            "carbsG": r["nutrition"]["carbsG"],
            "sodiumMg": r["nutrition"]["sodiumMg"],
            "diet": diet,
            "allergens": r["allergens"],
            "gmoRisk": r["gmo"]["risk"],
            "tags": r["tags"],
            "image": r["image"]["file"],
            "hasImage": (IMAGES / r["image"]["file"]).exists(),
        })

    (ROOT / "index.json").write_text(json.dumps(index, indent=2) + "\n")

    def counts(fn) -> dict:
        c = Counter()
        for r in index:
            v = fn(r)
            if isinstance(v, (list, set, tuple)):
                c.update(v)
            else:
                c[v] += 1
        return dict(sorted(c.items(), key=lambda kv: (-kv[1], str(kv[0]))))

    diet_counts = {flag: sum(1 for r in index if r["diet"][flag]) for flag in index[0]["diet"]}
    facets = {
        "totalRecipes": len(index),
        "generated": "scripts/build_index.py",
        "genre": counts(lambda r: r["genre"]),
        "chef": counts(lambda r: r["chefSlug"] or "(none)"),
        "subgenre": counts(lambda r: r["subgenre"]),
        "difficulty": counts(lambda r: r["difficulty"]),
        "timeBucket": counts(lambda r: r["timeBucket"]),
        "spiceBucket": counts(lambda r: r["spiceBucket"]),
        "equipment": counts(lambda r: r["equipment"]),
        "allergens": counts(lambda r: r["allergens"]),
        "gmoRisk": counts(lambda r: r["gmoRisk"]),
        "tags": counts(lambda r: r["tags"]),
        "diet": dict(sorted(diet_counts.items(), key=lambda kv: -kv[1])),
        "pantryPerfect": sum(1 for r in index if r["specialtyCount"] == 0),
        "imagesPresent": sum(1 for r in index if r["hasImage"]),
        "medians": {
            "totalMin": sorted(r["totalMin"] for r in index)[len(index) // 2],
            "calories": sorted(r["calories"] for r in index)[len(index) // 2],
            "ingredientCount": sorted(r["ingredientCount"] for r in index)[len(index) // 2],
        },
    }
    (ROOT / "facets.json").write_text(json.dumps(facets, indent=2) + "\n")

    chef_count = sum(1 for r in index if r["chefSlug"])
    print(f"index.json   {len(index)} recipes ({chef_count} chef-attributed)")
    print(f"facets.json  {len(facets['tags'])} tags, {len(facets['subgenre'])} subgenres")
    print(f"images       {facets['imagesPresent']}/{len(index)} present")
    print(f"pantry-only  {facets['pantryPerfect']} recipes need nothing special")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
