# Gusteau: Your Personal Chef Assistant

Gusteau turns the food you already have into one meal you can actually make, then stays beside you while you cook. When something changes mid-recipe, Gusteau replans the rest of the meal without breaking any of your rules.

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

1. Click **Load demo kitchen** on the home screen. The kitchen has rice, canned black beans, tortillas, cheese and salsa. The rules are vegetarian, 15 minutes, microwave only, and no purchases.
2. Gusteau recommends a **Microwave Rice & Bean Burrito Bowl** (14 min). The constraint check shows every rule passing.
3. Click **Cook with Gusteau**, then **Done, next step**. This marks "Prep the beans" as finished.
4. In the chat, type **Actually, I don't have rice.** and press Send. You can also click **I'm out of an ingredient** and choose **Rice**.
5. Watch the **Plan updated** card:
   - Rice is marked unavailable, and the substitution rice → tortillas appears in the Kitchen Plan.
   - The dish becomes a **Bean & Cheese Tortilla Bowl**, and time drops from 14 to 9 minutes.
   - "Get the rice going" is replaced by the new step "Make tortilla bowls". Your finished bean prep is kept.
   - Vegetarian, 15-minute, microwave-only and no-purchase rules are all shown as kept, with **0 new purchases**.
6. Try the other curveball buttons. Try **I only have 5 minutes** in chat to see Gusteau refuse to bend a hard rule and pause the plan, then **Undo**.

For the photo path, click **Use a sample fridge photo**. Then review the detections, adjust the rules, and cook.

With a live model, the steps above are the same but the dish names and wording vary from run to run. On the Pi, for example, "out of rice" has turned the bowl into bean-and-cheese quesadillas or burritos. The rules, the kept step, the rice → tortillas substitution and **0 new purchases** hold every time, because Gusteau's validator checks every model-written plan.

## How the agent works

```
photo(s) ──► ingredient detection ──► user-confirmed inventory ──► constraints
                                                                      │
             ┌────────────────────────────────────────────────────────┘
             ▼
     constraint-first planner ──► validator ──► ONE feasible recipe ──► guided cooking
             ▲                                                              │
             └──── replan whole remaining meal ◄── structured change ◄──────┘
                   (keeps completed steps, rules,             (chat or curveball button)
                    substitutions, purchase rule)
```

1. **Photo → detections.** The vision model returns ingredient names, confidence and a quantity guess. Low-confidence items are flagged "Please double-check".
2. **User-confirmed inventory.** Nothing is used until the user confirms the list. A visible reminder says that recognition can miss items, quantities, labels, allergens or freshness, and that packaging should be checked for allergy safety.
3. **Constraints.** Hard rules (diet, allergies, equipment, time, purchases, budget) are never broken. Soft preferences only steer the choice.
4. **One feasible recipe.** The planner fills recipe slots (base, protein, cheese and so on) from the inventory. It scores the options to use perishables first, match preferences, and avoid purchases. An independent `validateRecipe` check runs on every plan, including model-written ones.
5. **Live, state-preserving replanning.** Every change, whether typed in chat or clicked, becomes a structured `SessionChange`. Gusteau then:
   - updates the session state;
   - replans the **whole remaining meal**, preferring the current dish and ingredients so it changes as little as possible;
   - keeps steps you already finished (step keys are stable across replans) and resumes at the first unfinished step;
   - records substitutions, a diff of ingredients, quantities, steps and time, and the list of rules carried through;
   - never adds a grocery item when purchases are off, and announces any new purchase loudly when they are on;
   - pauses with an explanation instead of breaking a hard rule, with one-click undo.

The full session state is shown live in **Gusteau's Kitchen Plan**. It holds confirmed and unavailable ingredients, hard rules, preferences, equipment, time, servings, spending, the current recipe and step, active substitutions, the timeline and the change history.

## Where a real model replaces the mocks

All model access goes through one interface, `ChefModelService`, in `src/services/modelService.ts`:

| Capability | Interface method | Mock (default) | Real model |
| --- | --- | --- | --- |
| Fridge/pantry image understanding and ingredient extraction | `analyzePhotos()` | `src/services/mock/mockData.ts` (canned detections) | `OpenAICompatModelService.analyzePhotos()`, vision model |
| Recipe planning | `planRecipe()` | `src/agent/planner.ts` (template planner) | `OpenAICompatModelService.planRecipe()`, text model |
| Conversational replanning | `interpretMessage()` | `src/services/mock/intentParser.ts` | `OpenAICompatModelService.interpretMessage()`, text model |

- `src/services/llm/openAICompatModelService.ts` talks to any OpenAI-compatible Chat Completions API. That covers NVIDIA Nemotron on Nebius Token Factory and Ollama.
- The provider is chosen **at runtime, on the server**. The browser asks `GET /api/config` at startup and switches to the real model if one is configured. `src/services/index.ts` does this. One build therefore works in every mode.
- The browser only calls `/api/llm/chat/completions`. The server forwards it to the provider and adds any API key, so keys never reach the browser. In development `vite.config.ts` does this. In production `deploy/gusteau_server.py` does.
- **The model proposes, Gusteau disposes.** Every model-written recipe is checked by `validateRecipe()` in `src/agent/planner.ts`. The check covers ingredients, unavailable items, diet rules, equipment named in the steps, time, purchases and budget. If the plan breaks a rule, or the call fails, Gusteau's built-in planner steps in and the recipe card says why. Model chat output is sanitized into known change types before it touches the session.
- For the first plan, the model receives the built-in planner's verified draft as a starting point. This keeps live plans grounded in "use what you have".

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
src/
  types.ts                     Session state, recipe and change types
  agent/
    planner.ts                 Constraint-first planner, validator, quantity checks
    replan.ts                  applyChanges → replan → diff, substitutions, Gusteau's voice
  data/
    ingredients.ts             Ingredient catalog, diet rules, units and formatting
    recipes.ts                 Recipe templates with ingredient slots and stable step keys
  services/
    modelService.ts            The model seam (interface)
    index.ts                   Runtime provider selection via /api/config
    mock/                      Mock detections, intent parser, mock service
    llm/                       OpenAI-compatible client (Nemotron on Nebius, Ollama)
    foodSafety.ts              Placeholder for a future Tavily-backed guidance lookup
  state/useSession.ts          Session store and the replanning loop
  components/                  Screens, plus cooking/ for the guided cooking mode
deploy/
  gusteau_server.py            Production server for the Pi (static files + model proxy + wake-on-demand)
  gusteau.service              systemd unit
  gusteau.env.example          Server configuration template
```

## Prototype-only features

- **Personalized cooking video.** A "coming soon" card previews a narrated storyboard built from the current, adjusted steps. No video is generated.
- **Food-safety lookup.** A placeholder for Tavily search restricted to trusted sources such as FoodSafety.gov. It returns a few static, general guidance snippets with links. It is not a medical, allergy, freshness or contamination check.

## Known limits

- Mock detection returns the same believable haul for any photo.
- Quantity notes are free text. Gusteau warns when a recipe needs more than you noted, but it does not block on quantities.
- The template planner covers nine dishes and about fifteen ingredients. Unknown ingredients are kept in the inventory and passed to the real model, but the mock planner does not cook with them.
- The Nebius path was tested against a local fake OpenAI-compatible server, not against live Token Factory. The Ollama path was tested end to end against the MacBook.
- Live-model output varies. Vision models misread some items, for example tortillas as "pie crust" in the cartoon sample photo, so the review step matters.
- Gusteau is a cooking assistant, not a food-safety or allergy authority.
