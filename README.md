# Gusteau: Your Personal Chef Assistant

Gusteau helps you decide what to make and then cooks it with you. Start from what you're craving: pick a cuisine, browse popular dishes, filter by diet, time, difficulty or equipment, or just tell Gusteau what you're in the mood for ("something with cheese"), and preview a recipe. There's no ingredient inventory to fill in: once you've picked a dish, tell Gusteau anything you're missing and he adapts it. Once you start cooking, Gusteau shows one instruction at a time with a live stage bar and timers, answers questions, shows technique clips, and listens hands-free if you want. When something changes mid-recipe, it replans the rest of the meal without breaking any of your rules.

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

1. On first launch, pick a few cuisines and a diet (or skip). You land on **What are you craving?** To see the welcome screen again, click **↺ Reset as new user** in the header (a prototype tool; it clears this browser's preferences and history).
2. In the sidebar, click **Load the demo**. The preview opens for the **Microwave Rice & Bean Burrito Bowl** with the demo rules: vegetarian, 15 minutes and microwave only. It shows the ingredients, the four cooking stages, and a **Don't have it?** button on each ingredient.
3. Click **Cook with Gusteau**, then **Done, next step**. This finishes "Prep the beans".
4. In the chat, type **Actually, I don't have rice.** (or tap the suggestion, or use **I'm out of an ingredient**). Gusteau says the bowl really needs the rice, asks whether you have tortillas or couscous instead, and changes nothing until you answer (say **Couscous**).
5. Say **yes**, and watch the **Plan updated** card:
   - Rice → tortillas, and the dish becomes the **Microwave Tortilla & Bean Burrito Bowl**.
   - "Cook the rice" is replaced by the new step **Make tortilla cups**, and the stage bar follows. Your finished bean prep is kept.
   - About 13 → 9 minutes to go, and every rule shown as kept.
6. Type **I only have 5 minutes**. Gusteau won't break the time rule, so it pauses and asks how to go on. **Undo** brings the plan back.
7. Try **I'm allergic to dairy**. There's no dairy-free swap for the cheese, so Gusteau pauses and offers **Cook without shredded cheese**. Accepting drops the "Melt the cheese" step.

Also try: **Set a 5 minute timer**, **How do I dice an onion?** (video card), **What is mirin?** (picture card), and **Go hands-free** in the status bar. Gusteau only listens once a recipe is under way, through hands-free or the 🎤 in the chat.

With a live model, the flow is the same. The model groups recipes into stages, reads chat, and steps in when the rule-based replanner can't find a swap. Every model answer is validated before it's used.

## How the app works

```
onboarding (cuisines, diet, equipment) ──► browse: cuisine → popular dishes, filters, "picked for you"
                                                       │        ▲ or by voice: "something with cheese"
                                                       ▼
                                        recipe preview: ingredients, "don't have it?", swaps, stages, rules for this cook
                                                       │
                                                       ▼
                                 cooking workspace: stage bar, one step at a time, timers, clips, chat, voice
                                                       │
                     change (chat, voice, button) ──► replan the remaining meal ──► validate ──► Plan updated
                                                       (keeps finished steps and rules)
```

1. **Recipes come from a database export.** `src/recipes/source.ts` loads `public/recipes/recipes.json` (or `.csv`) at runtime and normalizes it. See [docs/RECIPE_FORMAT.md](docs/RECIPE_FORMAT.md). The 51 recipes shipped across 25 cuisines are placeholders until the real database export arrives.
2. **Stages.** Each recipe is grouped into 3–5 ordered stages, each with an icon from a fixed list (`src/data/stageIcons.ts`). The database, the model or Gusteau's heuristic may propose a grouping. `validateStages()` checks every one: all steps covered once and in order, the stage count, and known icons only. The app controls how icons look and tracks progress.
3. **Rules, not an inventory.** Your diet, allergies and equipment are stored in this browser (`src/state/profile.ts`). Gusteau never asks what ingredients you have and doesn't assume either way: an ingredient is missing only once you say so ("I don't have butter", or **Don't have it?** in the preview), and then he doesn't assume you have nothing else. He suggests what could stand in and asks whether you have it ("Do you have another kind of cheese you'd like to use? Otherwise, we can make the burger without it."), offering to go without only when the dish still works without it. A substitute you name is checked against your rules and the recipe, and used once you say yes. For something the dish is built on (its protein, bread, rice or pasta, flour, or what it's named after) he explains briefly and asks what you have instead (`src/agent/missing.ts`).
4. **Replanning** (`src/agent/adapt.ts`). Every change becomes a structured `SessionChange`. Gusteau then re-derives the remaining plan from the original recipe and everything it now knows. For each problem ingredient it suggests a swap that plays the same role (`SUBSTITUTES` in `src/data/ingredients.ts`), leaves out an optional garnish or seasoning, or pauses and asks. Finished steps are never rewritten, and swaps they depended on stay locked. `validatePlan()` independently checks ingredients, diet and allergy rules, equipment named in the steps, and the time left. Gusteau never cooks with something you said you don't have.
5. **Nutrition.** The recipe preview shows calories, protein, carbs and fat per serving, plus fiber, sugar and sodium, for the dish as Gusteau will actually make it. Figures come from the database when the export has them, shifted for any swaps. Otherwise `src/data/nutrition.ts` estimates them from the ingredient amounts, labels them as estimates, and lists anything it couldn't count.
6. **Learning your taste.** Finished dishes are remembered, and "Picked for you" ranks recipes by favorite and cooked cuisines, proteins you've enjoyed, and popularity.

## Where a real model replaces the mocks

All model access goes through one interface, `ChefModelService`, in `src/services/modelService.ts`:

| Capability | Interface method | Mock (default) | Real model |
| --- | --- | --- | --- |
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
| `LLM_MODEL` | The text model (`LLM_TEXT_MODEL` also works). |
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
# text nvidia/Llama-3_3-Nemotron-Super-49B-v1_5
```

Restart the server after changing them. The header badge shows the active model. Check the Token Factory catalog for exact Nemotron model IDs. The Nebius path was tested against a local fake of the API, not a live key.

## Hands-free test (voice in, voice out)

`npm run dev`, then open http://localhost:5173/asr.html. Press the mic (or Space) and talk to Gusteau. Your words appear as they're recognized. When you pause, the phrase goes to the text model, and the answer streams into a box while it's read aloud. The mic pauses while Gusteau speaks so he doesn't hear himself. Esc stops him, and a new phrase interrupts an answer he's still working on. Each answer shows how long the first words, the first audio and the whole reply took. The page is dev-only and isn't part of the production build.

Everything runs on the M5 Max:

- **Speech to text:** NVIDIA `nemotron-3.5-asr-streaming-0.6b` (Q8_0 GGUF) in [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) with the Metal backend.
- **Answers:** the dev server's text model (`GUSTEAU_PROVIDER` and `LLM_*` above), for example `qwen3.6:35b-mlx` on Ollama. `src/asr/assistant.ts` has the spoken-style prompt and streams replies through `/api/llm` (`src/services/llm/chatStream.ts`). The page warms the model up when it opens, because a cold load takes about 5 s.
- **Text to speech:** Magpie TTS on the same NeMo-Speech.cpp server. `src/voice/speaker.ts` speaks each sentence as soon as it's complete and synthesizes the next one while the current one plays. The browser's voice is available as a fallback.

`nemo-speech serve` listens on the Mac's `127.0.0.1:8080` only, so the dev server reaches it through an SSH tunnel:

- **`ASR_SSH_TARGET=user@host`** in `.env.local` makes `npm run dev` open `ssh -N -L 127.0.0.1:8080:127.0.0.1:8080 user@host` and reconnect it if it drops, for example when the Mac sleeps or Wi-Fi changes. If port 8080 is already open, for instance from a tunnel you started yourself, it uses that instead.
- The browser only calls `/api/asr/*`. `vite.config.ts` forwards it, including the realtime WebSocket, to `ASR_BASE_URL` (default `http://127.0.0.1:8080`) and adds `ASR_API_KEY` if the server was started with `--api-key`.
- `src/voice/nemotronAsr.ts` streams the mic as 16-bit PCM to `/v1/audio/transcriptions/realtime` and handles partial and final transcripts. The server's endpointing is off, so the client sends `input_audio_buffer.commit` itself after a pause.

### In the app

The main app uses the same pipeline for **Hands-free** (in the cooking status bar) and the **🎤** in the cooking chat. `src/voice/useVoice.ts` picks the engines:

- **Ears:** Nemotron ASR when the dev server can reach the speech server, otherwise the browser's Web Speech API (`useSpeech.ts`). Production builds, including the Pi, use the browser, because only the dev server proxies `/api/asr`. If the tunnel drops mid-session, hands-free retries for about 15 s, then turns itself off and says why.
- **Voice:** Magpie (voice Jason, set by `GUSTEAU_VOICE` in `src/voice/useVoice.ts`) on the same server, otherwise the browser's voice. Everything Gusteau says goes through one queue (`src/voice/voiceOut.ts`). The mic is muted while he talks and reopens 300 ms after he stops. Esc or "Gusteau is talking · Stop" silences him.
- **Topics:** Gusteau only talks about food and cooking (drinks and pairings included). The model flags off-topic messages and answers them with a short redirect to the recipe, with no plan changes, timers or videos. Offline, `src/services/topic.ts` does the same check, and Wikipedia lookups and video searches always carry cooking context.
- **Model and debug view:** the header's drop-down switches the model Gusteau uses (the provider's chat models, from `/api/llm/models`; remembered in this browser). **🐞 Debug** shows three boxes: the transcription history (everything heard, with what Gusteau did with it, and everything he said), every request sent to the model with all its messages and settings, and each raw response as it streams in (`src/debug/debugLog.ts`, `src/components/DebugPanel.tsx`).
- **Hands-free everywhere:** hands-free starts on the craving page (the dock at the bottom) and stays on through the preview and the kitchen. Gusteau answers to “Hey Gusteau” or “Hey Chef” (`src/voice/wakeWord.ts`, with the ways speech recognition writes them). Voice is **always on**: it starts as the page loads and there's no off switch. One control, on every screen: **Say “Hey Chef” or Tap Here!**, with what Gusteau is doing underneath (waiting for “Hey Chef” or “Hey Gusteau”, listening, hearing you, one moment, speaking, or muted). Called by name, he greets you (“Hey! What are you in the mood for?”) and listens ten seconds for an answer; tapped, he chimes and listens five. Once you start, he hears you out however long you talk (a request ends after two seconds without new words, so a pause to think doesn’t cut you off). After each answer he keeps listening five seconds for more, or ten when he asked you something or is waiting on an answer (“Do you have another kind of cheese?”, “say “let’s cook””). If nobody talks, he goes back to waiting for his name. A tap also interrupts him mid-sentence. **Mute** (or saying “mute”) stops the mic hearing anything, “Hey Chef” included, until **Unmute**. **Stop** turns listening off completely (no mic, not even for “Hey Chef”; saying “turn off” does the same) and is remembered across reloads; **Start** turns it back on and Gusteau starts the conversation himself. The sliders button picks the **microphone** (with a live level meter; switching reopens the mic straight away) and the **speaker** (with a test sound) Gusteau uses, remembered in this browser (`src/voice/audioDevices.ts`). Choosing a speaker needs Chrome or Edge, and the browser's own speech recognition and voice, the fallbacks when the Mac's server is unavailable, always use the system defaults. There's no separate wake-word engine: the always-open speech recognizer writes everything down and `wakeWord.ts` spots his name, including the ways Nemotron misspells it. Browsers block sound until the first tap or key press on a page, so on a fresh load he may hear you before he can be heard; the status line says “tap once to hear him” until then, and the first tap anywhere unlocks his voice. If the Mac's speech server drops and the browser can't stand in, voice retries every 15 seconds (or on a tap).
- **Choosing what to cook, by conversation** (`src/agent/voiceBrowse.ts`, `src/agent/discovery.ts`): Gusteau opens with “What are you in the mood for?” and searches with whatever you share (a cuisine, ingredient, craving, diet, time or equipment: “something cheesy”, “vegetarian, under 20 minutes”, “Mexican but no oven”). The thumbnails show the results while he names one or two and offers the rest; “read them all” reads them four at a time, numbered, with “more” and “repeat”. Choose by name, position (“the third one”, “number five”) or a tap. He then introduces the dish: the time, one or two main ingredients, and a nutrition highlight only when the recipe database supplies nutrition. “What do I need?” reads the ingredients with amounts; “I don’t have butter” starts the same ask-first conversation as in the kitchen before the recipe changes (also when said before choosing). With a model connected, `discover` reads what you mean and proposes one action (search, choose, ask a follow-up, or answer a food question); the app runs and checks it, says what was actually found, and says so when part of a request matches nothing. Without a model, Gusteau’s own reading does the same.
- **Cooking by voice:** “next” / “I’m ready”, “go back” / “what did I just do?”, “repeat that”, “what step am I on?”, “tell me more” (the full written step), “skip this step” and “start over” (both ask first). These work in the kitchen without the wake word, as whole phrases only; so does a yes or no when Gusteau has asked one. Back, Repeat and Next stay on screen as buttons.
- **Spoken guidance, not the screen read aloud** (`src/agent/stepSpeech.ts`): the screen keeps the title and full instruction; Gusteau says a short line like a chef would (“Start by shaping the patties. Divide the beef into four balls…”), with numbers, fractions, units and temperatures said in words, the title only when it adds something, and safety tips kept. With a model connected it phrases the steps (`phraseSteps`), and each line is checked against the written step (no new numbers, ingredients or step labels) before it's used; otherwise Gusteau's own wording is used. The transition depends on how you got there: “Start by…”, “Next…”, “While that cooks…” (a timer is running), “Back a step…”, “Last one…”.
- **Timers for timed parts of a step** (`src/agent/stepTimers.ts`): a step like "microwave for 8 minutes, then let it stand for 2 minutes" has two timed parts, each with a label ("Microwave the rice", "Rest the rice"). Gusteau offers them when he reads the step and the step card shows a button for each, but nothing starts until you say so. By voice (no “Hey Chef” needed while cooking): “start the timer” (the next one) or “start the rest timer”, “pause the timer”, “resume the timer”, “stop the timer” (or “stop the beeping”), “how much time is left?”, “add a minute”, and “pause all timers”; with several running he asks which. A range (“3 to 4 minutes”) is timed to the shorter time so you can check; “per side” offers the second side once the first rings; when one rings he says which one and offers the next part of the step, and while it keeps ringing he beeps and reminds you which timer it is every 30 seconds (four times) until you stop it.
- **Brain:** a spoken phrase goes to Gusteau like a chat message, with the full recipe-aware context: rules, what you've said you have or don't have, steps, the current step and the last few messages. Commands such as "what's next", "repeat that", "go back", "set a five-minute timer" and "show me how" are handled locally and instantly. Everything else goes to `interpretMessage()`, which asks the model for `{"changes": [...], "reply": ...}` with changes first. When there are no plan changes, the reply is read aloud while it's still being written. When there are, Gusteau speaks the validated replan message, then reads the step the plan lands on.
- **Kitchen help** works the same typed or spoken:
  - **Substitutions:** "What can I use instead of rice?" is answered from the safe swaps for what's left. These already fit the cook's rules and equipment, and the ones they have come first (`substitutionHints()` in `src/agent/adapt.ts`). Gusteau then offers the swap, and "yes" applies it instantly.
  - **Changes to the recipe:** "use couscous instead of rice", "add some spinach" and "make it spicier" become `swap_ingredient` or `add_to_recipe` changes. The replanner applies them as their own steps and validates them like any other change. Requests that can't work (something not in the kitchen, or something that breaks a rule) are answered locally with "I'd skip that", without asking the model. A failed swap or addition is never kept.
  - **Challenges:** burning, sticking, too salty, too thin, still cold, soggy and similar get a quick fix for the current step, with a timer when more cooking helps. Something ruined can be replanned around with a "yes".
  - **Guardrails on the model:** changes to time, servings or equipment only count when the cook's own words ask for them. When the model helps with a replan, its swaps must do the same job in the dish, and it may not drop steps the cook still needs. Otherwise Gusteau pauses and asks.
  - **Offline:** the same help works in mock mode, and when the model can't be reached (`src/services/mock/kitchenHelp.ts`).
- **Ask before changing ingredients:** "I'm out of rice" or "use couscous instead" never changes the plan straight away. Gusteau lists the swaps that fit, with what the cook has first, and asks. "Yes", naming an option ("tortillas"), or "leave it out" applies it, through the replanner and its checks. A pick that can't be used is explained, and the options stay open (`proposeIngredientChange()` and `answerOffer()` in `src/services/mock/kitchenHelp.ts`).
- **"What's a zester?"** "What is mirin?", "what does a colander look like?" and "I don't know what a skillet is" get a short definition from Wikipedia (read aloud in hands-free mode) and a card with pictures from the same article on Wikimedia Commons, with credit links (`src/services/lookup.ts`). The browser fetches them directly; only the word leaves the app. "Got it", Esc, × or the button closes the card, and "Show pictures" in the chat brings it back.
- **"How do I dice an onion?"** "How to brown chicken", "show me how to fold", **Show me how** on a step, and "how do I do that?" (meaning the current step) open a video card: Gusteau's written how-to plus short videos (5 minutes or less) found on YouTube. Only videos whose titles mention what was asked, and whose owners allow embedding, are kept. The server reads YouTube's public search results page (`/api/videos` in `vite.config.ts` and `deploy/gusteau_server.py`), so no API key is needed. YouTube's terms don't allow that kind of automated access, though, and it can break whenever YouTube changes the page; the official YouTube Data API (with a free key) is the robust alternative. If search fails, the card shows the how-to and a "Watch on YouTube" search link. Like the picture card, "got it", Esc, × or the button closes it, and the chat link brings it back.
- **Turning hands-free on** warms the model up and asks how Gusteau can help with the recipe. Finished timers are announced.

Measured on the M5 Max through the real pipeline, from the moment a phrase is final: a plan change is spoken after about 0.4 s, a question's first sentence goes to Magpie after about 0.4 s, and "what's next" reads the next step after about 0.3 s. There's no voice barge-in yet: you can't talk over Gusteau, because the mic is muted while he speaks.

## Raspberry Pi deployment

Gusteau runs on the Pi `antoineraspi` as a systemd service. It starts at boot and restarts if it crashes.

- **URL:** http://antoineraspi:8080 or http://192.168.6.126:8080. Phones on the same network can use the IP address. The Pi also has Tailscale, so the app is reachable on the Pi's Tailscale address at port 8080.
- **Files:** everything is in `/home/antoined/gusteau`: the `dist/` build, `gusteau_server.py`, `gusteau.env` and a copy of `gusteau.service`.
- **Server:** `deploy/gusteau_server.py` uses only the Python standard library, so nothing was installed on the Pi. It serves the app, answers `/api/config` and `/api/health`, and proxies only the chat-completions route.
- **Model:** `qwen3.6:35b-mlx` on the MacBook's Ollama (port 11434) handles planning and chat: about 6 s per plan and under 1 s per chat message.
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
    kitchen.ts                 Rule checks, filters, recommendations
    stages.ts                  Stage grouping heuristic and validator
  data/
    cuisines.ts                The 25 cuisines
    ingredients.ts             Name matching, diet tags, categories, amounts, substitutions
    stageIcons.ts              The supported stage icons
    techniques.ts              Curated technique clips (add vetted clip URLs here)
    rules.ts                   Diet rules and equipment
  services/                    The model seam: mock/ (offline) and llm/ (Nemotron, Ollama)
  state/                       Profile (localStorage) and the cooking session store
  voice/useSpeech.ts           Mic, hands-free mode and read-aloud (Web Speech API)
  components/                  Onboarding, Browse, RecipePreview, VoiceDock, cooking/
deploy/
  gusteau_server.py            Production server for the Pi (static files + model proxy + wake-on-demand)
  gusteau.service              systemd unit
  gusteau.env.example          Server configuration template
```

## Prototype-only features

- **Technique videos** come from YouTube's public search page, not its API (see above). `src/data/techniques.ts` has 22 techniques with written how-tos and search phrases.
- **Sample recipes.** The shipped recipes are Gusteau-written placeholders with no chef attribution.

## Known limits

- Voice needs a browser with the Web Speech API (Chrome, Edge, Safari) and HTTPS or localhost. Elsewhere the mic is hidden and everything works by typing.
- The substitution table covers common ingredients. Unusual ones are left out if they're optional or a seasoning; otherwise Gusteau pauses (or, with a live model, asks the model and validates its answer).
- Ingredient matching works on names, so "pasta" in a step isn't linked to "spaghetti" in the list. That affects which ingredients a step shows, not the safety checks.
- The profile lives in one browser. There are no accounts.
- Gusteau can't verify freshness or allergens, and says so wherever it matters.
