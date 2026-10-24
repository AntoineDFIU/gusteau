# Gusteau: Your Personal Chef Assistant

Gusteau helps you decide what to make and then cooks it with you. Start from what you're craving: pick a cuisine, browse popular dishes, filter by what's in your kitchen, your diet, time, difficulty or equipment, and preview a recipe. Once you start cooking, Gusteau shows one instruction at a time with a live stage bar and timers, answers questions, shows technique clips, and listens hands-free if you want. When something changes mid-recipe, it replans the rest of the meal without breaking any of your rules.

Built as a hackathon MVP with React, TypeScript, Tailwind CSS and Vite. It runs fully offline with mock AI. Server-side configuration switches it to a real model: NVIDIA Nemotron through Nebius Token Factory, or any Ollama model on your network.

A live deployment runs on the Raspberry Pi at **http://antoineraspi:8080** (or http://192.168.6.126:8080), using `qwen3.6:35b-mlx` on the MacBook's Ollama. See [Raspberry Pi deployment](#raspberry-pi-deployment).

## Run it locally

You need Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. No API key is needed. The header badge reads **Demo mode · mock AI**.

To open it on a phone on the same Wi-Fi, run `npm run dev:lan` and visit the **Network** URL it prints. On Windows, allow inbound TCP port 5173 for your Private network if the phone can't connect.

Other scripts:

```bash
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

## The 60-second demo

1. On first launch, pick a few cuisines and a diet (or skip). You land on **What are you craving?**
2. In the sidebar, click **Load demo kitchen**. The preview opens for the **Microwave Rice & Bean Burrito Bowl** with the demo kitchen: rice, canned black beans, tortillas, cheese and salsa. The rules are vegetarian, 15 minutes, microwave only, and no purchases. The preview shows what you have, the four cooking stages, and that Gusteau will leave out the optional cumin and cilantro you don't have.
3. Click **Cook with Gusteau**, then **Done, next step**. This finishes "Prep the beans".
4. In the chat, type **Actually, I don't have rice.** (or tap the suggestion, or use **I'm out of an ingredient**).
5. Watch the **Plan updated** card:
   - Rice → tortillas, and the dish becomes the **Microwave Tortilla & Bean Burrito Bowl**.
   - "Cook the rice" is replaced by the new step **Make tortilla cups**, and the stage bar follows. Your finished bean prep is kept.
   - About 13 → 9 minutes to go, every rule shown as kept, and **0 new purchases**.
6. Type **I only have 5 minutes**. Gusteau won't break the time rule, so it pauses and asks how to go on. **Undo** brings the plan back.
7. Try **I'm allergic to dairy**. There's no dairy-free swap for the cheese, so Gusteau pauses and offers **Cook without shredded cheese**. Accepting drops the "Melt the cheese" step.

Also try: **Set a 5 minute timer**, **How do I mash?** (technique card), **Hands-free** in the status bar, and the **🎤 Ask Gusteau** button while browsing ("something Thai under 20 minutes", "I have rice, eggs and spinach").

With a live model, the flow is the same. The model groups recipes into stages, reads chat, and steps in when the rule-based replanner can't find a swap. Every model answer is validated before it's used.

## How the app works

```
onboarding (cuisines, diet, equipment) ──► browse: cuisine → popular dishes, filters, "picked for you"
                                                       │        ▲ pantry: typed or photo (confirmed by you)
                                                       ▼
                                        recipe preview: have / missing / swaps, stages, rules for this cook
                                                       │
                                                       ▼
                                 cooking workspace: stage bar, one step at a time, timers, clips, chat, voice
                                                       │
                     change (chat, voice, button) ──► replan the remaining meal ──► validate ──► Plan updated
                                                       (keeps finished steps, rules, purchase limit)
```

1. **Recipes come from a database export.** `src/recipes/source.ts` loads `public/recipes/recipes.json` (or `.csv`) at runtime and normalizes it. See [docs/RECIPE_FORMAT.md](docs/RECIPE_FORMAT.md). The 51 recipes shipped across 25 cuisines are placeholders until the real database export arrives.
2. **Stages.** Each recipe is grouped into 3–5 ordered stages, each with an icon from a fixed list (`src/data/stageIcons.ts`). The database, the model or Gusteau's heuristic may propose a grouping. `validateStages()` checks every one: all steps covered once and in order, the stage count, and known icons only. The app controls how icons look and tracks progress.
3. **Pantry and rules.** Your pantry, diet, allergies and equipment are stored in this browser (`src/state/profile.ts`). Photo detections must be confirmed or edited before they're used, with a reminder that recognition can miss items, allergens or freshness.
4. **Replanning** (`src/agent/adapt.ts`). Every change becomes a structured `SessionChange`. Gusteau then re-derives the remaining plan from the original recipe and everything it now knows. For each problem ingredient it swaps something you have (`SUBSTITUTES` in `src/data/ingredients.ts`), leaves out an optional garnish or seasoning, adds a purchase only when you allow purchases, or pauses and asks. Finished steps are never rewritten, and swaps they depended on stay locked. `validatePlan()` independently checks ingredients, diet and allergy rules, equipment named in the steps, the time left, and purchases.
5. **Nutrition.** The recipe preview shows calories, protein, carbs and fat per serving, plus fiber, sugar and sodium, for the dish as Gusteau will actually make it. Figures come from the database when the export has them, shifted for any swaps. Otherwise `src/data/nutrition.ts` estimates them from the ingredient amounts, labels them as estimates, and lists anything it couldn't count.
6. **Learning your taste.** Finished dishes are remembered, and "Picked for you" ranks recipes by favorite and cooked cuisines, proteins you've enjoyed, pantry fit and popularity.

## Where a real model replaces the mocks

All model access goes through one interface, `ChefModelService`, in `src/services/modelService.ts`:

| Capability | Interface method | Mock (default) | Real model |
| --- | --- | --- | --- |
| Fridge/pantry photo → ingredients | `analyzePhotos()` | canned detections (`mock/mockData.ts`) | vision model |
| Chat and voice → changes, commands or answers | `interpretMessage()` | rule-based parser (`mock/intentParser.ts`) | text model (commands like "next" stay local and instant) |
| Group steps into stages with icons | `stageRecipe()` | database or heuristic stages | text model, checked by `validateStages()` |
| Help when the replanner is stuck | `adaptPlan()` | returns Gusteau's own plan | text model proposes swaps and rewritten steps, checked by `validatePlan()` |

- `src/services/llm/openAICompatModelService.ts` talks to any OpenAI-compatible Chat Completions API. That covers NVIDIA Nemotron on Nebius Token Factory and Ollama.
- The provider is chosen **at runtime, on the server**. The browser asks `GET /api/config` at startup and switches to the real model if one is configured. `src/services/index.ts` does this. One build therefore works in every mode.
- The browser only calls `/api/llm/chat/completions`. The server forwards it to the provider and adds any API key, so keys never reach the browser. In development `vite.config.ts` does this. In production `deploy/gusteau_server.py` does.
- **The model proposes, Gusteau disposes.** Stage groupings and replans written by the model are validated before use, and model chat output is sanitized into known change types. On any failure, Gusteau's own logic takes over.

### Configuration

The same variables work for `npm run dev` (put them in `.env.local`) and for the Pi (`gusteau.env`):

| Variable | Meaning |
| --- | --- |
| `GUSTEAU_PROVIDER` | `mock` (default), `nebius` or `ollama` |
| `LLM_BASE_URL` | OpenAI-compatible base URL. Defaults per provider. |
| `LLM_API_KEY` | Bearer token, if the provider needs one. Server-side only. |
| `LLM_MODEL` | One model for vision and text. Or set `LLM_VISION_MODEL` and `LLM_TEXT_MODEL`. |
| `LLM_EXTRA_BODY` | JSON merged into every request. The Ollama preset sends `{"reasoning_effort":"none"}`. |
| `LLM_WAKE_PORTS` | Pi server only. Wakes a sleeping Mac before model requests. See below. |

Ollama on your network:

```bash
GUSTEAU_PROVIDER=ollama
LLM_BASE_URL=http://macbook-pro-m5-max.local:11434/v1
LLM_MODEL=qwen3.6:35b-mlx
```

NVIDIA Nemotron on Nebius Token Factory:

```bash
GUSTEAU_PROVIDER=nebius
LLM_API_KEY=your-token-factory-key
# defaults: base https://api.tokenfactory.nebius.com/v1,
# vision nvidia/Nemotron-Nano-12B-v2-VL, text nvidia/Llama-3_3-Nemotron-Super-49B-v1_5
```

Restart the server after changing them. The header badge shows the active model. Check the Token Factory catalog for exact Nemotron model IDs. The Nebius path was tested against a local fake of the API, not a live key.

Uploaded photos are downscaled to JPEG (max 1280 px) in the browser before they are sent.

## Raspberry Pi deployment

Gusteau runs on the Pi `antoineraspi` as a systemd service. It starts at boot and restarts if it crashes.

- **URL:** http://antoineraspi:8080 or http://192.168.6.126:8080. Phones on the same network can use the IP address. The Pi also has Tailscale, so the app is reachable on the Pi's Tailscale address at port 8080.
- **Files:** everything is in `/home/antoined/gusteau`: the `dist/` build, `gusteau_server.py`, `gusteau.env` and a copy of `gusteau.service`.
- **Server:** `deploy/gusteau_server.py` uses only the Python standard library, so nothing was installed on the Pi. It serves the app, answers `/api/config` and `/api/health`, and proxies only the chat-completions route.
- **Model:** `qwen3.6:35b-mlx` on the MacBook's Ollama (port 11434) handles photos, planning and chat. In a benchmark of the four vision-capable models installed there, it was the fastest. It took about 3 s per photo, 6 s per plan and under 1 s per chat message.
- **Thinking off:** these models "think" by default and spend the whole token budget doing it, which returns empty answers. The Ollama preset turns that off.

**Public access.** Tailscale Funnel publishes Gusteau at **https://antoineraspi.tailb406ce.ts.net/Gusteau**. It shares the HTTPS address with PulseCareAI, which stays at the root `/` on port 8787. Production builds use the base path `/Gusteau/`, set as `BUILD_BASE` in `vite.config.ts`. The Pi server accepts paths with or without that prefix, so LAN access on port 8080 still works. The route was added with:

```bash
sudo tailscale funnel --bg --https=443 --set-path=/Gusteau http://127.0.0.1:8080
```

Use `tailscale funnel`, not `tailscale serve`, when changing routes. `serve` switches Funnel off for the whole address, which takes PulseCareAI off the internet too. A backup of the earlier config is in `~/gusteau/tailscale-serve-backup-*.json`.

Useful commands on the Pi:

```bash
sudo systemctl status gusteau        # is it running?
sudo journalctl -u gusteau -f        # live log, including model requests and wake-ups
sudo systemctl restart gusteau       # after editing gusteau.env
```

To redeploy after changing the code, run this from the project folder on your PC:

```bash
npm run build
scp -r dist deploy/gusteau_server.py antoined@antoineraspi:~/gusteau/
ssh -t antoined@antoineraspi sudo systemctl restart gusteau
```

### The MacBook going to sleep

When the MacBook sleeps, Ollama stops answering, and a request can freeze mid-answer. macOS will wake for connections to services it advertises over Bonjour, such as file sharing on port 445, AirPlay on 7000 and SSH on 22. Ollama isn't one of those.

The Pi server therefore uses `LLM_WAKE_PORTS=445,7000,22`. Before each model request it checks whether Ollama answers. If not, it connects to one of those ports to wake the Mac, then waits for Ollama, typically under a second. While a request runs, it keeps the Mac awake. It does nothing while nobody is using Gusteau.

This is a workaround. For a reliable demo, keep the Mac awake while it serves the model. Either plug it in and turn on "Prevent automatic sleeping when the display is off" under System Settings › Battery › Options, or run `caffeinate -s` in a Terminal while demoing.

## Project layout

```
public/recipes/recipes.json    The recipe library (sample data until the database export)
docs/RECIPE_FORMAT.md          What the database export should look like
src/
  types.ts                     Recipe, profile, session and change types
  recipes/                     Recipe source, normalizer, CSV parser
  agent/
    adapt.ts                   applyChanges → adaptRecipe → validatePlan → finalizeReplan
    kitchen.ts                 Rule checks, pantry matching, filters, recommendations
    stages.ts                  Stage grouping heuristic and validator
    browseIntent.ts            "Something Thai under 20 minutes" → filters
  data/
    cuisines.ts                The 25 cuisines
    ingredients.ts             Name matching, diet tags, categories, amounts, substitutions
    stageIcons.ts              The supported stage icons
    techniques.ts              Curated technique clips (add vetted clip URLs here)
    rules.ts                   Diet rules and equipment
  services/                    The model seam: mock/ (offline) and llm/ (Nemotron, Ollama)
  state/                       Profile (localStorage) and the cooking session store
  voice/useSpeech.ts           Mic, hands-free mode and read-aloud (Web Speech API)
  components/                  Onboarding, Browse, Pantry, RecipePreview, cooking/
deploy/
  gusteau_server.py            Production server for the Pi (static files + model proxy + wake-on-demand)
  gusteau.service              systemd unit
  gusteau.env.example          Server configuration template
```

## Prototype-only features

- **Technique clips.** `src/data/techniques.ts` has 22 tagged techniques with written how-tos. No video URLs are filled in yet, so the card shows the how-to and "clip coming soon". Add a vetted, embeddable public clip per technique (`youtube` id with start/end, or a file in `public/clips/`). Clips are preselected, never searched live.
- **Sample recipes.** The shipped recipes are Gusteau-written placeholders with no chef attribution.

## Known limits

- Voice needs a browser with the Web Speech API (Chrome, Edge, Safari) and HTTPS or localhost. Elsewhere the mic is hidden and everything works by typing.
- The substitution table covers common ingredients. Unusual ones are left out if they're optional or a seasoning; otherwise Gusteau pauses (or, with a live model, asks the model and validates its answer).
- Ingredient matching works on names, so "pasta" in a step isn't linked to "spaghetti" in the list. That affects which ingredients a step shows, not the safety checks.
- Mock detection returns the same believable haul for any photo.
- The profile lives in one browser. There are no accounts.
- Gusteau can't verify freshness or allergens, and says so wherever it matters.
