#!/usr/bin/env python3
"""Find a dish-specific Wikimedia Commons photo for each recipe.

Strict by design: a candidate is accepted only when its FILE NAME contains every
core word of the dish. Anything weaker keeps the recipe's existing Wikipedia lead
image, because a wrong-but-confident photo is worse than a generic one.

Writes a proposal file; it never edits data/. Run apply_commons.py to commit it.
"""
import argparse, json, pathlib, re, sys
from fetch_images import session, polite_get

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
API = "https://commons.wikimedia.org/w/api.php"

# Words that describe the cook, the mood or the marketing, not the dish.
STOP = {
    "with", "and", "the", "a", "an", "in", "on", "of", "or", "for", "to",
    "style", "homemade", "classic", "perfect", "simple", "easy", "quick",
    "best", "ultimate", "real", "proper", "authentic", "traditional", "basic",
    "my", "our", "grown", "up", "old", "fashioned", "fashion", "world",
    "famous", "signature", "favorite", "favourite", "crowd", "pleasing",
    "weeknight", "sunday", "holiday", "party", "fresh", "crispy", "crisp",
    "creamy", "fluffy", "tender", "juicy", "rich", "hearty", "light",
    "loaded", "stuffed", "double", "triple", "mini", "giant", "deluxe",
    "deep", "pan", "oven", "slow", "pressure", "air", "fried", "baked",
    "roast", "roasted", "grilled", "smoked", "braised", "seared", "poached",
    "steamed", "sauteed", "charred", "toasted", "whipped", "shaved",
}
# If a candidate names one of these and our dish does not, it is a different dish.
DISH_TYPES = {
    "cake", "cakes", "cupcake", "cupcakes", "soup", "stew", "pizza", "calzone",
    "sandwich", "sandwiches", "burger", "burgers", "slider", "sliders", "taco",
    "tacos", "burrito", "quesadilla", "tamale", "tamales", "salad", "pie",
    "tart", "quiche", "pasta", "lasagna", "risotto", "paella", "bread",
    "muffin", "muffins", "cookie", "cookies", "brownie", "brownies", "scone",
    "waffle", "waffles", "pancake", "pancakes", "donut", "doughnut", "dip",
    "sauce", "salsa", "soup", "chowder", "chili", "curry", "omelette",
    "omelet", "frittata", "pudding", "custard", "mousse", "sorbet", "gelato",
    "cocktail", "margarita", "smoothie", "juice", "tea", "coffee", "wrap",
    "skewer", "skewers", "kebab", "casserole", "gratin", "souffle", "terrine",
    "sausage", "meatball", "meatballs", "meatloaf", "stir", "fry", "noodle",
    "noodles", "dumpling", "dumplings", "rice", "beans", "fries", "chips",
}
NOISE = re.compile(
    r"\b(restaurant|cafe|café|bar|pub|hotel|inn|diner|bistro|market|"
    r"festival|museum|street|avenue|menu|sign|logo|interior|exterior|"
    r"storefront|shop|stall|truck|kitchen|chef|cook|portrait|plaque)\b", re.I)


def words(text):
    return [w for w in re.split(r"[^a-z0-9]+", text.lower()) if w]


def singular(w):
    if len(w) > 3 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("es") and not w.endswith("ses"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def core(title):
    """The words a photo must actually show."""
    return [singular(w) for w in words(title) if w not in STOP and len(w) > 2]


def search(s, query, limit=12):
    r = polite_get(s, API, params={
        "action": "query", "format": "json", "generator": "search",
        "gsrsearch": f"{query} filetype:bitmap", "gsrnamespace": "6",
        "gsrlimit": str(limit), "prop": "imageinfo",
        "iiprop": "url|size|extmetadata", "iiurlwidth": "800"})
    pages = (r.json().get("query") or {}).get("pages") or {}
    out = []
    for p in pages.values():
        info = (p.get("imageinfo") or [{}])[0]
        if not info.get("thumburl"):
            continue
        out.append({
            "title": p["title"].replace("File:", ""),
            "thumb": info["thumburl"],
            "width": info.get("width", 0),
            "height": info.get("height", 0),
            "meta": info.get("extmetadata", {}),
        })
    return out


def score(cand, need, have):
    """None = reject. Higher is better."""
    name = cand["title"].rsplit(".", 1)[0]
    seq = [singular(w) for w in words(name) if not w.isdigit()]
    toks = set(seq)
    if not set(need) <= toks:
        return None                      # must name every core word
    if NOISE.search(name):
        return None                      # a photo of a place, not a plate
    stray = (toks & DISH_TYPES) - set(have)
    if stray:
        return None                      # risotto *cakes* is not risotto
    if cand["width"] < 500 or cand["height"] < 400:
        return None
    # The first real noun in a filename is almost always the photo's subject.
    # "Croissant amb mascarpone cheesecake" is a croissant, not a cheesecake.
    lead = next((w for w in seq if w not in STOP and len(w) > 2), None)
    if lead is not None and lead not in have and lead not in need:
        return None
    extra = len(toks - set(need) - STOP)
    if extra > 2:
        return None                      # too much else going on in the frame
    return 100 - 8 * extra + min(cand["width"], 1600) / 400


def best(s, recipe):
    title = recipe["title"]
    need = core(title)
    have = {singular(w) for w in words(title)}
    if not need:
        return None
    seen, ranked = set(), []
    # Full title first, then drop leading qualifiers to widen the net.
    queries = [title]
    if len(need) > 2:
        queries.append(" ".join(need[-3:]))
    if len(need) > 1:
        queries.append(" ".join(need[-2:]))
    for q in queries:
        for c in search(s, q):
            if c["title"] in seen:
                continue
            seen.add(c["title"])
            sc = score(c, need, have)
            if sc is not None:
                ranked.append((sc, c))
        if ranked:
            break
    if not ranked:
        return None
    ranked.sort(key=lambda t: -t[0])
    return ranked[0][1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0,
                    help="probe every Nth recipe instead of all 900")
    ap.add_argument("--out", default="/tmp/commons_proposal.json")
    args = ap.parse_args()

    recipes = []
    for p in sorted(DATA.rglob("*.json")):
        for r in json.load(open(p)):
            recipes.append((p.name, r))
    if args.sample:
        recipes = recipes[::args.sample]

    s = session()
    hits, misses = [], []
    for i, (fname, r) in enumerate(recipes, 1):
        c = best(s, r)
        tag = "HIT " if c else "keep"
        print(f"[{i}/{len(recipes)}] {tag} {r['title'][:38]:38s} "
              f"{c['title'][:56] if c else r['image']['wikipedia']}", flush=True)
        (hits if c else misses).append({
            "id": r["id"], "slug": r["slug"], "file": fname,
            "title": r["title"], "current": r["image"],
            "commons": ({"title": c["title"], "thumb": c["thumb"],
                         "width": c["width"], "height": c["height"],
                         "meta": {k: v.get("value") for k, v in c["meta"].items()
                                  if k in ("Artist", "LicenseShortName",
                                           "Attribution", "Credit")}}
                        if c else None),
        })
    json.dump({"hits": hits, "misses": misses}, open(args.out, "w"), indent=1)
    n = len(recipes)
    print(f"\nmatched {len(hits)}/{n} ({len(hits)/n:.0%}), "
          f"keeping existing image for {len(misses)}")
    print(f"proposal -> {args.out}")


if __name__ == "__main__":
    sys.exit(main())
