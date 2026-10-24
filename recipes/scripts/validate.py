#!/usr/bin/env python3
"""Validate data/*.json against schema.json plus Gusteau's own consistency rules.

Run this after editing any recipe file:
    python3 scripts/validate.py
Exits non-zero on any error. Warnings do not fail the run.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMAGES = ROOT / "images"

GENRE_PREFIX = {"american": "am", "mexican": "mx", "italian": "it", "mediterranean": "md",
                "french": "fr", "international": "in"}
CORE_GENRES = ("american", "mexican", "italian", "mediterranean")
EASE_BAND = {"beginner": (8, 10), "intermediate": (5, 7), "advanced": (1, 4)}
ALLERGEN_DIET = {  # allergen present  <->  diet flag must be False
    "gluten": "glutenFree", "dairy": "dairyFree", "egg": "eggFree",
    "tree-nut": "nutFree", "peanut": "nutFree",
}
# Matched against hyphen-separated TOKENS of an ingredient key, never as substrings:
# "graham-crackers" and "hamburger-bun" must not read as "ham".
MEAT_TOKENS = {
    "beef", "chicken", "pork", "bacon", "sausage", "lamb", "turkey", "ham", "hock", "hocks",
    "pepperoni", "prosciutto", "pancetta", "chorizo", "anchovy", "anchovies", "shrimp",
    "salmon", "tuna", "cod", "clam", "clams", "fish", "steak", "brisket", "ribs", "rib",
    "meatball", "meatballs", "guanciale", "gelatin", "lard", "duck", "veal", "crab",
    "lobster", "oyster", "oysters", "mussels", "scallops", "andouille", "bresaola",
    "soppressata", "mortadella", "capicola", "tripe", "oxtail", "sardines", "tilapia",
    "halibut", "snapper", "octopus", "squid", "calamari", "bonito", "lardo", "suet",
}
# Whole keys that are animal products without an obvious token.
MEAT_KEYS = {"hot-dog", "cocktail-franks", "colatura", "nam-pla", "worcestershire"}

CHEF_SLUGS: set[str] = set()

errors: list[str] = []
warnings: list[str] = []


def main() -> int:
    files = sorted(DATA.rglob("*.json"))
    if not files:
        print("no recipe files in data/")
        return 1

    chef_file = ROOT / "chefs.json"
    global CHEF_SLUGS
    CHEF_SLUGS = ({c["slug"] for c in json.loads(chef_file.read_text())["chefs"]}
                  if chef_file.exists() else set())

    try:
        import jsonschema
        schema = json.loads((ROOT / "schema.json").read_text())
        validator = jsonschema.Draft7Validator(schema)
    except ImportError:
        validator = None
        warnings.append("jsonschema not installed - structural validation skipped")

    all_recipes: list[dict] = []
    for path in files:
        try:
            recipes = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            errors.append(f"{path.name}: invalid JSON - {exc}")
            continue
        if not isinstance(recipes, list):
            errors.append(f"{path.name}: top level must be an array")
            continue
        for recipe in recipes:
            recipe["_file"] = path.name
        all_recipes += recipes

    ids, slugs = Counter(), Counter()
    dish_images = {}
    for r in all_recipes:
        where = f"{r.get('_file')}:{r.get('id', '?')}"
        body = {k: v for k, v in r.items() if k != "_file"}

        if validator:
            for err in validator.iter_errors(body):
                errors.append(f"{where}: {'/'.join(str(p) for p in err.path)} {err.message}")

        ids[r.get("id")] += 1
        slugs[r.get("slug")] += 1

        genre, rid = r.get("genre"), r.get("id", "")
        chef = r.get("chef")
        if chef:
            if not rid.startswith("ch-"):
                errors.append(f"{where}: chef recipes need a ch-<initials>-NNN id")
            if chef.get("slug") not in CHEF_SLUGS:
                errors.append(f"{where}: chef slug {chef.get('slug')!r} is not in chefs.json")
        else:
            if rid.startswith("ch-"):
                errors.append(f"{where}: ch- id but no chef object")
            elif genre in GENRE_PREFIX and not rid.startswith(GENRE_PREFIX[genre] + "-"):
                errors.append(f"{where}: id prefix does not match genre {genre}")

        if len(r.get("ingredients", [])) != len(r.get("ingredientKeys", [])):
            errors.append(f"{where}: {len(r.get('ingredients', []))} ingredient lines but "
                          f"{len(r.get('ingredientKeys', []))} keys - they must correspond 1:1")

        keys = set(r.get("ingredientKeys", []))
        for extra in set(r.get("specialty", [])) - keys:
            errors.append(f"{where}: specialty item {extra!r} is not in ingredientKeys")

        if r.get("prepMin", 0) + r.get("cookMin", 0) != r.get("totalMin"):
            errors.append(f"{where}: totalMin must equal prepMin + cookMin")

        band = EASE_BAND.get(r.get("difficulty"))
        if band and not band[0] <= r.get("easeScore", 0) <= band[1]:
            errors.append(f"{where}: easeScore {r.get('easeScore')} outside {r['difficulty']} band {band}")

        diet, allergens = r.get("diet", {}), set(r.get("allergens", []))
        if diet.get("vegan") and not diet.get("vegetarian"):
            errors.append(f"{where}: vegan implies vegetarian")
        if diet.get("vegetarian") and not diet.get("pescatarian"):
            errors.append(f"{where}: vegetarian implies pescatarian")
        if diet.get("vegan") and (allergens & {"dairy", "egg"}):
            errors.append(f"{where}: vegan but declares {sorted(allergens & {'dairy', 'egg'})}")
        if diet.get("glutenFree") and diet.get("glutenFreeAdaptable"):
            errors.append(f"{where}: glutenFreeAdaptable must be false when already glutenFree")
        for allergen, flag in ALLERGEN_DIET.items():
            if allergen in allergens and diet.get(flag):
                errors.append(f"{where}: declares {allergen} but diet.{flag} is true")
        if diet.get("vegetarian"):
            meaty = [k for k in keys
                     if k in MEAT_KEYS or (set(k.split("-")) & MEAT_TOKENS)]
            if meaty:
                errors.append(f"{where}: marked vegetarian but has {sorted(meaty)}")
        if {"fish", "shellfish"} & allergens and diet.get("vegetarian"):
            errors.append(f"{where}: marked vegetarian but declares fish or shellfish")

        n = r.get("nutrition", {})
        if n:
            derived = 4 * n.get("proteinG", 0) + 4 * n.get("carbsG", 0) + 9 * n.get("fatG", 0)
            cal = n.get("calories", 0)
            # Ethanol carries 7 cal/g and is not a tracked macro, so alcoholic
            # drinks legitimately have more calories than protein/carbs/fat explain.
            boozy = {"cocktail", "adults-only"} & set(r.get("tags", []))
            if cal and not boozy and abs(derived - cal) > max(60, 0.25 * cal):
                warnings.append(f"{where}: calories {cal} vs {derived:.0f} from macros "
                                f"({abs(derived - cal) / cal:.0%} off)")
            if n.get("satFatG", 0) > n.get("fatG", 0):
                errors.append(f"{where}: satFatG exceeds fatG")
            if n.get("fiberG", 0) > n.get("carbsG", 0):
                errors.append(f"{where}: fiberG exceeds carbsG")

        img = r.get("image", {})
        if img and not (IMAGES / img.get("file", "")).exists():
            warnings.append(f"{where}: image {img.get('file')} not downloaded yet")
        if img.get("match") == "dish":
            dish_images.setdefault(img.get("file"), []).append(r["id"])

    # A photo claiming to show one specific dish must not be reused elsewhere.
    for f, owners in dish_images.items():
        if len(owners) > 1:
            errors.append(f"image {f} is marked match=dish but shared by "
                          f"{len(owners)} recipes: {', '.join(sorted(owners))}")

    for label, counter in (("id", ids), ("slug", slugs)):
        for value, count in counter.items():
            if count > 1:
                errors.append(f"duplicate {label} {value!r} appears {count} times")

    print(f"{len(all_recipes)} recipes across {len(files)} genre files\n")
    # The 50% beginner floor is a requirement on the BASE collection. Chef-attributed
    # recipes are signature dishes (Beef Wellington, Coq au Vin) and are reported
    # separately rather than being forced down to beginner level.
    base = [r for r in all_recipes if not r.get("chef")]
    chef_recipes = [r for r in all_recipes if r.get("chef")]

    print("base collection:")
    for genre, count in sorted(Counter(r.get("genre") for r in base).items()):
        rs = [r for r in base if r.get("genre") == genre]
        beginners = sum(1 for r in rs if r.get("difficulty") == "beginner")
        share = beginners / len(rs)
        print(f"  {genre:<14} {count:>4} recipes   beginner {beginners:>3}/{count} "
              f"({share:.0%}) {'ok ' if share >= 0.5 else 'LOW'}")
        if genre in CORE_GENRES and share < 0.5:
            errors.append(f"{genre}: only {share:.0%} beginner recipes, the floor is 50%")

    if chef_recipes:
        print("\nchef collection:")
        per_chef = Counter(r["chef"]["name"] for r in chef_recipes)
        for genre, count in sorted(Counter(r.get("genre") for r in chef_recipes).items()):
            rs = [r for r in chef_recipes if r.get("genre") == genre]
            beginners = sum(1 for r in rs if r.get("difficulty") == "beginner")
            print(f"  {genre:<14} {count:>4} recipes   beginner {beginners:>3}/{count} "
                  f"({beginners / len(rs):.0%})")
        print(f"  {len(per_chef)} chefs tagged, {min(per_chef.values())}-{max(per_chef.values())} recipes each")
        for name, count in sorted(per_chef.items()):
            if count != 25:
                warnings.append(f"chef {name} has {count} recipes, expected 25")

    total_beginner = sum(1 for r in all_recipes if r.get("difficulty") == "beginner")
    if all_recipes:
        print(f"\n  overall beginner share {total_beginner / len(all_recipes):.0%}")

    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings[:40]:
            print(f"  ! {w}")
        if len(warnings) > 40:
            print(f"  ... and {len(warnings) - 40} more")
    if errors:
        print(f"\n{len(errors)} ERROR(s):")
        for e in errors[:60]:
            print(f"  x {e}")
        if len(errors) > 60:
            print(f"  ... and {len(errors) - 60} more")
        return 1
    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
