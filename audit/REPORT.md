# Gusteau app audit

Date: October 29, 2026

## Rating

**7/10 overall — 8/10 as a demo, 6/10 for production readiness.**

Recipe discovery, typed interactions, previews, cooking commands, and normal voice operation work together. The interface has a coherent visual style. Voice recovery and keyboard accessibility are the main confirmed weaknesses. Ratings are a qualitative assessment of this local build, not a certification or a cross-browser benchmark.

## Scope and results

Tested the current working tree on localhost in headless installed Chrome at 1440 × 1000 and 390 × 844. Used fresh browser profiles, a fake microphone, and muted playback. Most UI checks used the offline model; one conversational search used the configured live Ollama model and returned HTTP 200. The voice check used actual Magpie synthesis and Nemotron transcription through the development proxy.

- Production build and TypeScript checks: passed.
- Automated tests: 21 passed (5 main-app search regressions and 16 existing tests for the separate web demo).
- Browser scenarios: 16 passed, 2 confirmed failures, after correcting test-selector and text-encoding errors in the initial audit scripts.
- Recipe data: all 51 records have ingredients and steps, unique IDs, and existing local image files.
- No uncaught JavaScript errors during the main UI flow.

Passing browser scenarios covered desktop pasta search; typed pasta requests; collapsed/expanded message counts; dropdown viewport fit and stacking; preserving chat drafts in previews; Escape minimizing chat without closing previews; starting cooking through chat; advancing a step; adding a timer; mobile browse/chat geometry; mobile preview/chat geometry; favorites surviving reload; normal voice greeting reaching Listening; live-model pasta discovery; and prerecorded speech driving recipe search.

The prerecorded voice test transcribed **“I want pasta”** and displayed Spaghetti Aglio e Olio and Stovetop Mac and Cheese. This verifies the microphone-to-search path with synthetic audio, not recognition quality in a noisy kitchen.

## Confirmed issues

### High priority: voice stays on fallback after an initial server failure

Reproduction: return 503 for the initial `/api/asr/health` checks, restore the server, then click Talk to Gusteau. The app does not make another health request and continues using browser recognition and browser voice.

Measured health-request counts: 2 before retry and 2 afterward. The audio settings explicitly reported browser recognition and browser voice. Two initial requests occur in development because of React StrictMode.

Relevant implementation: `src/voice/useVoice.ts`, initial probe around line 109 and browser startup branch around line 211. Retry should re-detect the server and coordinate recognition/output selection before starting the conversation.

Evidence: `voice-fallback.png` and the last scenario in `verification-results.json`.

### Medium priority: keyboard focus escapes recipe dialogs

Reproduction: open a recipe preview, focus Close, and repeatedly press Tab. Focus leaves the modal and reaches Debug, Preferences, the background search box, and cuisine controls. The dialog declares `aria-modal="true"` but does not contain keyboard focus.

Relevant implementation: `src/components/ui.tsx`, `Modal`. Add focus placement, Tab containment or a native dialog implementation, and focus restoration to the opener.

Evidence: the keyboard-focus scenario in `extended-results.json`.

## UX observations

- On mobile, an open chat and the voice panel can repeat the same long answer and occupy much of the viewport. Consider a shorter voice summary while typed chat is expanded.
- Several controls depend on emoji or icons, particularly in the narrow header. Clear accessible labels and consistent icon rendering would improve polish.
- The floating chat can cover recipe actions while expanded; minimizing it restores access. Consider a mobile sheet layout if users frequently alternate between instructions and chat.

## Limits

Not tested on physical phones, Safari, Firefox, real microphones/speakers, Bluetooth devices, or slow/intermittent connections beyond the simulated initial ASR failure. Model-answer quality, substitutions, cooking completion, and timer expiry were not exhaustively evaluated. The existing web-demo tests do not substitute for main-app coverage of those behaviors.

No application fixes were made during this audit. Reports and screenshots are saved in this directory; temporary browser tooling was installed outside the project dependencies.
