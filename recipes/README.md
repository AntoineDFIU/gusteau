# Gusteau Recipe Repository

900 recipes with structured metadata and Wikipedia images, built for filtering,
browsing and thumbnail/preview generation in the Gusteau app.

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

**Provenance.** These are *Gusteau's own instructions for dishes each chef is known
for* — not reproductions of their published recipe text. Recipe lists of ingredients
are not copyrightable, but the expressive instructions in a published cookbook are, so
every method here is written from scratch. Present these as "in the style of" /
"the dish X is known for", never as X's recipe, and do not add quoted headnotes or
instruction text from their books.

## Images and attribution

Dish images are ~800px Wikipedia lead images; chef portraits are ~500px. Every file
has a record in the sibling `attribution.json` with `artist`, `licence`, `credit` and
`file_page`.

**Wikipedia images are not public domain by default.** Most are CC BY-SA or CC BY and
require visible credit to the photographer and a link to the licence. Render the
`credit` string wherever an image is displayed at any meaningful size, or in an
accessible info panel on the enlarged preview. Public-domain files are marked as such
in `attribution.json` and need no credit.

Two caveats to carry into the UI:

- **A few dish images are representative rather than exact.** Seventeen dishes had no
  usable lead image on their own Wikipedia page and were mapped to the closest
  accurate article — e.g. *tinga* and *carne en su jugo* to `Mexican cuisine`,
  *chicken française* to `Schnitzel`, *stuffed shells* to `Conchiglie`. The photo shows
  the right kind of food, not necessarily that exact dish. The mapping is visible in
  each recipe's `image.wikipedia` field.
- **19 of 20 chef portraits.** Alex Guarnaschelli has no freely-licensed photograph on
  Wikipedia. Her entry has no `images/chefs/*.jpg` file and the UI should fall back to
  initials or a placeholder. No substitute photo of another person was used.

To re-fetch (existing files are skipped unless `--force`):

```sh
python3 scripts/fetch_images.py            # dish images, all data/**/*.json
python3 scripts/fetch_chef_images.py       # chef portraits
```

Both honour `Retry-After` and back off on HTTP 429; Wikipedia rate-limits a bulk run
of several hundred images, so expect the full sweep to take a while.
