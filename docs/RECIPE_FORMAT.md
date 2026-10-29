# Recipe database format

Gusteau loads its recipes at runtime from `public/recipes/`:

1. `recipes.json`, if present
2. otherwise `recipes.csv`

To replace the sample recipes, export the database to one of those files and drop it in. On the Pi, copy it to `~/gusteau/dist/recipes/`. You don't need to rebuild, just reload the page.

Field names are matched loosely (`total_minutes`, `totalMinutes` and `time` all work), so most exports load as they are. Records missing a title, ingredients or steps are skipped and counted in the browser console.

## JSON

Either a plain array of recipes or `{ "recipes": [ ... ] }`.

```json
{
  "id": "mx-microwave-burrito-bowl",
  "title": "Microwave Rice & Bean Burrito Bowl",
  "cuisine": "mexican",
  "description": "Fluffy rice, warm black beans and melty cheese, all in one microwave.",
  "chef": { "name": "Chef Name", "url": "https://link-to-the-published-original", "relation": "Inspired by" },
  "image": "recipes/images/burrito-bowl.jpg",
  "image_match": "dish",
  "image_attribution": {
    "artist": "Photographer",
    "credit": "Own work",
    "licence": "CC BY-SA 4.0",
    "licence_url": "https://creativecommons.org/licenses/by-sa/4.0/",
    "file_page": "https://commons.wikimedia.org/wiki/File:Example.jpg"
  },
  "total_minutes": 14,
  "servings": 2,
  "difficulty": "Easy",
  "equipment": ["microwave"],
  "tags": ["vegetarian", "quick"],
  "popularity": 92,
  "ingredients": [
    { "id": "rice", "name": "Rice", "amount": 0.75, "unit": "cup" },
    "1 can black beans, drained",
    { "name": "Cilantro", "amount": null, "unit": "a few sprigs", "optional": true }
  ],
  "steps": [
    { "key": "cook-rice", "title": "Cook the rice", "text": "Rinse the rice and microwave it for 8 minutes…", "uses": ["rice"], "timer_seconds": 480, "technique": "rice", "tip": "Use a big bowl." },
    "Spoon the warm beans over the rice and scatter with the cheese."
  ],
  "stages": [
    { "title": "Cook the rice", "icon": "microwave", "steps": ["cook-rice"] },
    { "title": "Build and serve", "icon": "assemble", "steps": [2] }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | |
| `ingredients` | yes | Objects or plain lines such as `"1 1/2 cups jasmine rice, rinsed"`. Gusteau parses the amount, unit, name and note. |
| `steps` | yes | Objects or plain strings. Without a `title`, Gusteau writes a short one from the text. Without `uses`, it finds the ingredients the text mentions. Without a timer, it reads "for 8 minutes" from the text. |
| `cuisine` | recommended | One of the 25 ids in `src/data/cuisines.ts` (`italian`, `west-african`, …) or the name (`"West African"`). Other values still load under "All". |
| `id` | recommended | Stable ids keep "Picked for you" history working across exports. |
| `chef` | optional | A name string or `{ name, url, relation }`. Shown as "Inspired by Chef Name" with a link to the original. |
| `equipment` | optional | Any of `stovetop`, `oven`, `microwave`, `blender`, `grill`. An empty list means no cooking. If the field is missing, Gusteau works it out from the step text. |
| `stages` | optional | 3–5 stages, each covering consecutive steps in order. Use step keys or 1-based step numbers. `icon` must be one of the ids in `src/data/stageIcons.ts`. If the stages are missing or invalid, a connected model or Gusteau's own heuristic groups the steps. |
| `nutrition` | optional | Per serving: `{ "calories": 512, "protein": 21, "carbs": 82, "fat": 10, "fiber": 10, "sugar": 2, "sodium": 680 }` (grams, sodium in mg). Strings like `"21 g"` work, and `"per": "recipe"` means totals for the whole dish. In CSV, use flat `calories`, `protein`, `carbs`, `fat`, `fiber`, `sugar` and `sodium` columns. Without it, Gusteau estimates nutrition from the ingredients and labels it as an estimate. |
| `total_minutes`, `servings`, `difficulty`, `popularity`, `tags`, `image`, `emoji`, `description` | optional | `image` can be a hosted URL or a path relative to the app root. For local photos, put the file in `public/recipes/images/` and use `recipes/images/<filename>`. Other fields have reasonable defaults. |
| `image_match`, `image_attribution` | optional | Use `dish` only when the photo depicts the recipe; mark generic related photos `representative` so the UI labels them. Include attribution credit and licence details with licensed local photos. |

## CSV

One row per recipe, with a header row. Columns use the same names as the JSON fields. List columns (`ingredients`, `steps`, `equipment`, `tags`) take items separated by `|` or one per line inside a quoted cell. A `stages` cell looks like `Prep:prep:1 | Cook:saute:2,3 | Serve:plate:4`, meaning title:icon:step numbers.

```csv
id,title,cuisine,chef,chef_url,total_minutes,servings,difficulty,equipment,ingredients,steps
it-limone,Pasta al Limone,italian,Chef Name,https://…,20,2,Easy,stovetop,"200 g spaghetti | 1 lemon, zested | 3 tbsp butter","Boil the spaghetti for 9 minutes. | Melt the butter with the lemon zest. | Toss everything together."
```

## About chef recipes

Ingredient lists are generally fine to use. A chef's written method, headnotes and photos usually are not, without permission or a license. Unless the database has those rights, prefer:

- Gusteau's own wording of the method, with `chef.relation` set to "Inspired by" and `chef.url` linking to the published original
- no chef photos or logos

When Gusteau adapts a recipe mid-cook, the app says so ("Adapted by Gusteau from…"), so a changed dish is never presented as the chef's original.
