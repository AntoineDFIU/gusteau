# Working on Gusteau

Welcome! This gets you from a fresh clone to a running app in a few minutes.

## Get it running

You need [Node.js](https://nodejs.org) 18 or newer and git.

```bash
git clone https://github.com/AntoineDFIU/gusteau.git
cd gusteau
npm install
npm run dev
```

Open http://localhost:5173. The app starts in **mock mode**. Photo detection, planning and chat all run locally with no API keys, so you can build and demo without any model.

To see the headline demo, click **Load demo kitchen**, then **Cook with Gusteau**, then **Done, next step**. Then type "Actually, I don't have rice." in the chat. The README walks through the rest.

## Using a real model (optional)

Copy `.env.example` to `.env.local` and fill it in. `.env.local` is git-ignored, so **never put keys anywhere else**.

- **Ollama on your own machine:** set `GUSTEAU_PROVIDER=ollama`, `LLM_BASE_URL=http://localhost:11434/v1` and `LLM_MODEL=<a vision-capable model you have pulled>`.
- **NVIDIA Nemotron on Nebius:** set `GUSTEAU_PROVIDER=nebius` and `LLM_API_KEY=<your key>`.

Restart `npm run dev` after changing it. The badge in the header shows which model is active.

## Before you push

```bash
npm run build      # typecheck + production build; must pass
```

There's no automated test suite yet. Click through the demo flow above in mock mode before opening a pull request.

## How we work

- Don't commit straight to `main`. Create a branch, push it, and open a pull request:
  ```bash
  git checkout -b your-name/short-description
  git push -u origin your-name/short-description
  ```
- Keep pull requests small and describe what you changed and how you checked it. The pull-request template prompts for this.
- Never commit secrets, `.env.local`, `node_modules/` or `dist/`. The `.gitignore` already covers these.

## Where things live

| Area | Files |
| --- | --- |
| Screens and UI | `src/components/` (cooking mode in `src/components/cooking/`) |
| Replanning, rule checks, stages | `src/agent/adapt.ts`, `src/agent/kitchen.ts`, `src/agent/stages.ts` |
| Recipes (database export) | `public/recipes/`, loaded by `src/recipes/`; format in `docs/RECIPE_FORMAT.md` |
| Cuisines, ingredients, substitutions, technique clips | `src/data/` |
| Voice | `src/voice/useSpeech.ts` |
| Model integrations | `src/services/` (`mock/` for offline, `llm/` for Nemotron and Ollama) |
| Raspberry Pi server | `deploy/` |

## The live deployment

The shared demo runs on Antoine's Raspberry Pi at https://antoineraspi.tailb406ce.ts.net/Gusteau, using a model on Antoine's MacBook. Merging to `main` does **not** deploy it automatically. Ask Antoine to redeploy, using the steps in the README.
