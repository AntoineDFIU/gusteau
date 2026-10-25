# Gusteau Recipe Repository

900 recipes with structured metadata and freely-licensed photography, built for
filtering, browsing and thumbnail/preview generation in the Gusteau app.

## Provenance — read this before writing any product copy

**The dishes are real. The recipe text is original. None of it has been cooked.**

- **Selection is drawn from the real world.** These are genuinely popular dishes, and
  the chef-tagged ones are genuinely the dishes each chef is known for — Beef
  Wellington for Ramsay, the smoked salmon pizza for Puck, mole poblano for Bayless.
- **Every ingredient quantity, step, timing and nutrition figure was written for this
  repository.** Nothing was scraped, retrieved, licensed or reproduced from a cookbook,
  a chef's published recipe, or a recipe site. This applies to all 900 — the 400 base
  recipes exactly as much as the 500 chef ones.
- **Zero recipes are kitchen-tested.** No one has cooked any of these and reported
  back. Quantities, timings, temperatures and yields are reasoned estimates grounded in
  standard technique, not observed results. Expect a tail of recipes with ratio or
  timing errors that only cooking will surface.

Supportable product claim: *popular and signature dishes, with original instructions
written for Gusteau.* **Not** supportable: "recipes from celebrity chefs", "tested",
"kitchen-tested", "chef-approved", or any rating implying cooks have made these.

The legal reason the text is original rather than sourced: an ingredient list is a
statement of fact and is not copyrightable, but the expressive instruction text in a
published cookbook is. Reproducing a chef's method verbatim into a shipped product
would infringe; writing fresh instructions for the dish they are known for does not.

| Collection | Count | Layout |
| --- | --- | --- |
| Base genres | 400 | `data/american.json`, `data/mexican.json`, `data/italian.json`, `data/mediterranean.json` — 100 each |
| Celebrity chefs | 500 | `data/chefs/<chef-slug>.json` — 20 chefs × 25 recipes |

## Layout

```
recipes/
├── schema.json              JSON Schema (draft-07) every recipe conforms to
├── chefs.json               the 20-chef roster: name, cuisine, known-for, portrait
├── index.json               slim browse records (generated)
├── facets.json              filter counts + medians (generated)
├── data/
│   ├── american.json        am-001 … am-100
│   ├── mexican.json         mx-001 … mx-100
│   ├── italian.json         it-001 … it-100
│   ├── mediterranean.json   md-001 … md-100
│   └── chefs/*.json         ch-<initials>-001 … -025 per chef
├── images/
│   ├── *.jpg                dish photos, ~800px wide
│   ├── attribution.json     per-image artist / licence / credit / file page
│   └── chefs/
│       ├── <slug>.jpg       chef portraits, ~500px wide
│       └── attribution.json
└── scripts/
    ├── fetch_images.py      download dish images  (--force, --dry-run, --only)
    ├── fetch_chef_images.py download chef portraits
    ├── validate.py          schema + cross-field + collection-level checks
    └── build_index.py       regenerate index.json and facets.json
```

Regenerate after any data change:

```sh
python3 scripts/validate.py     # must print "all checks passed"
python3 scripts/build_index.py
```

## Recipe fields

Every record carries: `id, slug, title, genre, subgenre, description, difficulty,
easeScore, spiceScore, popularity, pantryScore, servings, prepMin, cookMin, totalMin,
equipment, ingredients, ingredientKeys, specialty, steps, diet, allergens, gmo,
nutrition, tags, image` — plus `chef` on the chef collection. `schema.json` is the
authority; the notes below cover what the schema cannot express.

**`easeScore` 1–10 and `difficulty`** are locked together and validated:
beginner 8–10, intermediate 5–7, advanced 1–4. Across the whole repository 63% of
recipes are beginner; the base collection is 59–70% beginner per genre, which is the
floor the user asked for and `validate.py` enforces as an error. Chef recipes are
reported separately — several signature dishes (Beef Wellington, cassoulet, mole
poblano, brisket) are legitimately advanced and should stay that way.

**`spiceScore` 0–10** is perceived heat, not capsaicin content: 0–2 is not spicy,
3–4 warm, 5–6 noticeably hot, 7+ genuinely hot.

**`pantryScore` 1–10** is how likely a US household already has everything. It is the
inverse of `specialty`, which lists the `ingredientKeys` a typical pantry probably
lacks — use `specialty` to count a recipe's missing ingredients against user inventory.

**`ingredients` and `ingredientKeys` are positional 1:1.** `ingredients[i]` is the
display string ("2 cans (28 oz each) San Marzano tomatoes") and `ingredientKeys[i]` the
canonical slug (`san-marzano-tomatoes`) for matching. A key may legitimately repeat
(salt in two places). `validate.py` enforces equal lengths and that `specialty` is a
subset of `ingredientKeys`.

**`prepMin + cookMin == totalMin`**, enforced. `cookMin` absorbs cooking, baking,
resting, marinating, brining and chilling time, so a few totals are long by design
(limoncello is 48 hours, dry-brined turkey is 24+).

**`equipment`** uses a wider vocabulary than the app's three-value `Equipment` type
(stovetop, oven, microwave, grill, broiler, air-fryer, slow-cooker, pressure-cooker,
blender, food-processor, no-cook). Map broiler→oven and the small appliances to
whichever of the app's values applies; the mapping note is in `schema.json`.

**`diet`** flags `vegetarian, vegan, pescatarian, glutenFree, glutenFreeAdaptable,
dairyFree, nutFree, eggFree`. Validated for consistency: vegan implies vegetarian,
vegetarian implies pescatarian, `glutenFree` and `glutenFreeAdaptable` are mutually
exclusive, and the flags must agree with `allergens`. Note that Worcestershire sauce
and fish sauce contain anchovy, so a few dishes that read as vegetarian are flagged
pescatarian instead — that is deliberate, not an error.

**`glutenFreeAdaptable`** means a direct substitution works (gluten-free pasta, corn
tortillas instead of flour). It does not mean the recipe as written is safe.

### GMO: a sourcing risk rating, not a claim about the dish

`gmo.risk` is `low | moderate | high` with a `sources` array naming why
(`seed-oil, corn, soy, sugar-beet, cottonseed, grain-fed-meat, grain-fed-dairy,
processed-sauce, processed-bread, processed-cheese, cornstarch, corn-syrup,
papaya, squash, none`).

This is an honest judgement about *how likely the commodity inputs are to derive from
GM crops in the US supply chain* — not a test result and not a statement about any
specific product. A recipe using canola oil, corn tortillas and conventionally raised
beef is rated `high` because those categories are predominantly GM-derived in the US;
buying organic or non-GMO-verified versions of the same ingredients changes the answer.
Present it to users as sourcing guidance, never as a measurement.

### Nutrition values are estimates

Per-serving figures (`calories, proteinG, carbsG, fiberG, sugarG, fatG, satFatG,
sodiumMg, cholesterolMg`) are reasoned estimates from standard ingredient composition,
cross-checked against 4·protein + 4·carbs + 9·fat. They are not lab analyses and
actual values swing with portioning, brand and how much fat renders off. Do not present
them to users as exact, and do not use them for medical decisions.

Alcoholic drinks are exempt from the macro cross-check in `validate.py` — ethanol
carries 7 cal/g and is not one of the tracked macros, so a margarita's calories
legitimately exceed what its protein, carbs and fat explain.

## Chef collection

`chefs.json` holds the 20-chef roster with `slug, name, rank, cuisine, knownFor,
wikipedia, image, genres`. Each chef has 25 recipes under `data/chefs/<slug>.json`,
tagged with `chef: {name, slug}` so users can filter by chef. Chef recipe ids are
namespaced `ch-<initials>-NNN`, and `genre` on these records may also be `french` or
`international` (Wolfgang Puck's Austrian dishes, Jacques Pépin's French ones), which
the base four-genre collection never uses.

**Provenance.** See the Provenance section at the top — it applies to the whole
library, not just this collection. For the chef recipes specifically: present them as
"the dish X is known for" or "in the style of X", never as X's recipe, and never add
quoted headnotes or instruction text from their books.

## Images and attribution

Every image is freely licensed, from Wikimedia Commons or Wikipedia, and every file has
a record in the sibling `attribution.json` with `artist`, `licence`, `credit` and
`file_page`. Dish photos are ~800px; chef portraits ~500px.

### Two tiers, and the UI must tell them apart

`image.match` says how much to trust the photo:

| `match` | `source` | What it means | Filename |
| --- | --- | --- | --- |
| `dish` | `commons-file` | A Commons photo whose own filename names this dish. Shows this dish. | `<recipe-slug>.jpg`, unique to that recipe |
| `representative` | `wikipedia-lead` | A Wikipedia article's lead image. Shows the right *kind* of food, not necessarily this preparation. | shared between variants of one dish |

`index.json` carries `imageMatch` per recipe and `facets.json` totals both tiers.
**Caption or de-emphasise `representative` photos** — do not present them as a picture
of that recipe. A `representative` photo is deliberately shared: several chili variants
point at one chili photograph, because Commons has no picture of "Cocoa and Chipotle
Chili" and a confident wrong image is worse than an obviously generic one.

`validate.py` errors if a `match: "dish"` file is ever shared by two recipes, so this
distinction cannot silently erode.

### Licensing is not optional

**These images are not public domain by default.** Most are CC BY-SA or CC BY and
legally require visible credit to the photographer plus a link to the licence. Render
the `credit` string wherever an image appears at any meaningful size, or in an
accessible info panel on the enlarged preview. Files marked `CC0` or `Public domain` in
`attribution.json` need no credit.

Matches were rejected rather than used where the licence was impractical (GFDL, which
requires shipping the full licence text) or where Commons had no artist metadata to
credit under a BY/BY-SA licence. Those recipes fell back to `representative`.

### Known gaps

- **Recipes on `representative` photos.** Mostly invented variants and compound titles
  that no photographer has captioned — "Chicken Scarpariello", "Cocoa and Chipotle
  Chili". This is the honest ceiling of free-licence coverage, not a bug to fix by
  loosening the matcher.
- **19 of 20 chef portraits.** Alex Guarnaschelli has no freely-licensed photograph on
  Wikipedia. She has no `images/chefs/*.jpg` and the UI should fall back to initials or
  a placeholder. No substitute photo of another person was used.

### Re-running the pipeline

```sh
python3 scripts/match_commons.py --out /tmp/proposal.json   # propose; edits nothing
python3 scripts/match_commons.py --sample 30 --out /tmp/s.json   # quick probe
python3 scripts/apply_commons.py --proposal /tmp/proposal.json   # download + rewrite
python3 scripts/fetch_images.py                             # wikipedia-lead fallbacks
python3 scripts/fetch_chef_images.py                        # chef portraits
```

`match_commons.py` is deliberately strict: a candidate is accepted only if its filename
contains every core word of the dish, its leading noun is one of those words, and it
adds no more than two extra words. Loosening any of those three rules reintroduces
wrong-but-confident photos — it was rejecting a croissant for cheesecake and mushroom
risotto for parmesan risotto.

All scripts honour `Retry-After` and back off on HTTP 429. A full 900-recipe match plus
download takes well over an hour.
