import { stepTimers, timerClock, timerSignal } from './step-timers.js';

const $ = id => document.getElementById(id);

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['ready', 'done', 'question', 'change', 'repeat'] },
    reply: { type: 'string' },
    note: { type: 'string' },
    substitution: {
      type: 'object',
      properties: {
        originalIngredient: { type: 'string' },
        revisedIngredient: { type: 'string' },
        revisedSteps: { type: 'array', items: { type: 'object', properties: {
          stepNumber: { type: 'integer' }, instruction: { type: 'string' },
        }, required: ['stepNumber', 'instruction'] } },
        note: { type: 'string' },
      },
      required: ['originalIngredient', 'revisedIngredient', 'revisedSteps', 'note'],
    },
  },
  required: ['action', 'reply', 'note', 'substitution'],
};

export function applyIngredientSubstitution(recipe, proposal) {
  if (!proposal || typeof proposal.originalIngredient !== 'string' ||
      typeof proposal.revisedIngredient !== 'string' || !Array.isArray(proposal.revisedSteps) ||
      typeof proposal.note !== 'string') return null;
  const index = recipe.ingredients.findIndex(item => item === proposal.originalIngredient);
  const replacement = proposal.revisedIngredient.trim();
  const detail = proposal.note.trim();
  if (index < 0 || !replacement || replacement.length > 220 || detail.length > 220 ||
      replacement === proposal.originalIngredient || proposal.revisedSteps.length > recipe.steps.length) return null;
  const steps = [...recipe.steps];
  const seen = new Set();
  for (const edit of proposal.revisedSteps) {
    if (!Number.isInteger(edit?.stepNumber) || edit.stepNumber < 1 || edit.stepNumber > steps.length ||
        seen.has(edit.stepNumber) || typeof edit.instruction !== 'string' ||
        !edit.instruction.trim() || edit.instruction.length > 2000) return null;
    seen.add(edit.stepNumber);
    steps[edit.stepNumber - 1] = edit.instruction.trim();
  }
  const ingredients = [...recipe.ingredients];
  ingredients[index] = replacement;
  const note = `Substituted ${proposal.originalIngredient} with ${replacement}.${detail ? ` ${detail}` : ''}`;
  return { recipe: { ...recipe, ingredients, steps }, note };
}

function addLine(speaker, text) {
  const item = document.createElement('li');
  const name = document.createElement('strong');
  name.textContent = `${speaker}: `;
  item.append(name, document.createTextNode(text));
  $('cooking-history').append(item);
  $('cooking-history').scrollTop = $('cooking-history').scrollHeight;
}

function renderRecipe(recipe, activeStep = -1) {
  const root = $('recipe-detail');
  root.replaceChildren();
  if (!recipe) return;
  const title = document.createElement('h3');
  title.textContent = recipe.title;
  const description = document.createElement('p');
  description.textContent = recipe.description;
  const meta = document.createElement('p');
  meta.className = 'muted';
  meta.textContent = `${recipe.servings} servings · ${recipe.totalMin} min · ${recipe.equipment.join(', ')}`;
  const overview = document.createElement('div');
  overview.className = 'recipe-overview';
  const summary = document.createElement('div');
  summary.append(title, description, meta);
  overview.append(summary);
  if (recipe.image?.file) {
    const preview = document.createElement('img');
    preview.className = 'recipe-preview';
    preview.src = `/api/recipe-images/${encodeURIComponent(recipe.image.file)}`;
    preview.alt = recipe.title;
    preview.loading = 'lazy';
    preview.addEventListener('error', () => preview.remove());
    overview.append(preview);
  }
  const grid = document.createElement('div');
  grid.className = 'recipe-grid';
  const ingredients = document.createElement('div');
  const ingredientsTitle = document.createElement('h4');
  ingredientsTitle.textContent = 'Ingredients';
  const ingredientsList = document.createElement('ul');
  for (const ingredient of recipe.ingredients) {
    const item = document.createElement('li');
    item.textContent = ingredient;
    ingredientsList.append(item);
  }
  ingredients.append(ingredientsTitle, ingredientsList);
  const steps = document.createElement('div');
  const stepsTitle = document.createElement('h4');
  stepsTitle.textContent = 'Recipe steps';
  const stepsList = document.createElement('ol');
  for (const [index, instruction] of recipe.steps.entries()) {
    const item = document.createElement('li');
    item.textContent = instruction;
    if (index === activeStep) item.className = 'step-active';
    stepsList.append(item);
  }
  steps.append(stepsTitle, stepsList);
  grid.append(ingredients, steps);
  root.append(overview, grid);
  if (recipe.adjustments?.length) {
    const adjustments = document.createElement('div');
    adjustments.className = 'recipe-adjustments';
    const heading = document.createElement('h4');
    heading.textContent = 'Substitution notes';
    const list = document.createElement('ul');
    for (const note of recipe.adjustments) {
      const item = document.createElement('li');
      item.textContent = note;
      list.append(item);
    }
    adjustments.append(heading, list);
    root.append(adjustments);
  }
}

const techniqueCues = [
  { pattern: /\b(chop|dice|mince|slice|cut|peel|grate)\b/i, icon: '🔪', label: 'Prepare' },
  { pattern: /\b(boil|blanch)\b/i, icon: '♨️', label: 'Boil' },
  { pattern: /\b(drain|strain|rinse)\b/i, icon: '🫗', label: 'Drain' },
  { pattern: /\b(whisk|mix|stir|combine|fold|toss)\b/i, icon: '🥣', label: 'Mix' },
  { pattern: /\b(sear|sauté|saute|fry|brown|warm|heat)\b/i, icon: '🍳', label: 'Cook in a pan' },
  { pattern: /\b(simmer|reduce)\b/i, icon: '🍲', label: 'Simmer' },
  { pattern: /\b(bake|roast|broil|preheat)\b/i, icon: '🔥', label: 'Use the oven' },
  { pattern: /\b(rest|cool|chill|refrigerate|freeze)\b/i, icon: '⏱️', label: 'Wait' },
  { pattern: /\b(garnish|serve|plate|sprinkle)\b/i, icon: '🍽️', label: 'Finish and serve' },
];

function renderStepVisuals(recipe, stepIndex) {
  const root = $('step-visuals');
  if (!recipe || stepIndex < 0 || stepIndex >= recipe.steps.length) {
    root.replaceChildren();
    delete root.dataset.stepKey;
    root.hidden = true;
    return;
  }
  const stepKey = `${recipe.id}:${stepIndex}`;
  if (root.dataset.stepKey === stepKey) return;
  root.replaceChildren();
  root.dataset.stepKey = stepKey;
  root.hidden = false;
  const heading = document.createElement('h3');
  heading.textContent = `Visual guide · Step ${stepIndex + 1} of ${recipe.steps.length}`;
  const layout = document.createElement('div');
  layout.className = 'visual-layout';
  if (recipe.image?.file) {
    const photo = document.createElement('div');
    const image = document.createElement('img');
    image.className = 'visual-photo';
    image.src = `/api/recipe-images/${encodeURIComponent(recipe.image.file)}`;
    image.alt = `Finished ${recipe.title}`;
    image.loading = 'lazy';
    image.addEventListener('error', () => photo.remove());
    const caption = document.createElement('span');
    caption.className = 'visual-caption';
    caption.textContent = 'Finished dish reference';
    photo.append(image, caption);
    layout.append(photo);
  }
  const cues = document.createElement('div');
  cues.className = 'visual-cues';
  const sentences = recipe.steps[stepIndex].split(/(?<=[.!?])\s+(?=[A-Z])/).map(part => part.trim()).filter(Boolean);
  for (const sentence of sentences.slice(0, 4)) {
    const cue = techniqueCues.find(item => item.pattern.test(sentence)) || { icon: '👩‍🍳', label: 'Follow this instruction' };
    const card = document.createElement('div');
    card.className = 'visual-cue';
    const icon = document.createElement('span');
    icon.className = 'visual-icon';
    icon.textContent = cue.icon;
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = cue.label;
    const detail = document.createElement('p');
    detail.textContent = sentence;
    copy.append(label, detail);
    card.append(icon, copy);
    cues.append(card);
  }
  layout.append(cues);
  const searches = document.createElement('div');
  searches.className = 'video-searches';
  const query = `${recipe.title} ${sentences[0] || recipe.steps[stepIndex]}`.slice(0, 150);
  const cookingQuery = `${query} cooking recipe`;
  for (const [label, url] of [
    ['YouTube Shorts', `https://www.youtube.com/results?search_query=${encodeURIComponent(`${cookingQuery} shorts`)}`],
    ['Instagram videos', `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(`${cookingQuery} reel`)}`],
    ['TikTok videos', `https://www.tiktok.com/search/video?q=${encodeURIComponent(cookingQuery)}`],
  ]) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `Search ${label} ↗`;
    link.setAttribute('aria-label', `Search ${label} for step ${stepIndex + 1} in a new tab`);
    searches.append(link);
  }
  root.append(heading, layout, searches);
}

export function videoQuery(transcript, recipe, stepIndex) {
  if (!/\b(show|demonstrat\w*|video|clip|watch|see how|how (?:do|can|could|should|would|to))\b/i.test(transcript)) return '';
  let subject = transcript.replace(/^(?:can|could|would|will)\s+you\s+/i, '')
    .replace(/^(?:please\s+)?(?:show|demonstrate|find|play|pull up)\s+(?:me\s+)?(?:(?:a|some)\s+)?(?:(?:short\s+)?videos?\s+(?:showing|of|about|on)?\s*)?/i, '')
    .replace(/^how\s+(?:(?:I|we|you)\s+(?:can|could|do|should|would)|(?:can|could|do|should|would)\s+(?:I|we|you)|to)\s+/i, '')
    .replace(/[?.!]+$/g, '').trim();
  if (!subject || /^(?:me\s+)?(?:how\s+to\s+)?(?:do\s+)?(?:this|that|it)(?:\s+step)?$/i.test(subject)) {
    subject = recipe.steps[stepIndex].split(/[,.!?]|\bthen\b|\band\b/i)[0];
  }
  return subject.split(/\s+/).slice(0, 6).join(' ').slice(0, 120);
}

export function visualRequest(transcript, recipe, stepIndex) {
  const spoken = transcript.trim().replace(/[?.!]+$/g, '');
  const actionRequest = /\b(?:how\s+(?:(?:I|we|you)\s+(?:do|can|could|should|would)|(?:do|can|could|should|would)\s+(?:I|we|you)|to)|demonstrat\w*|video|clip|watch|see how)\b/i.test(spoken);
  if (actionRequest) {
    const query = videoQuery(spoken, recipe, stepIndex);
    return query ? { kind: 'video', query } : null;
  }
  if (!/\b(?:look(?:s)? like|picture|photo|image|visual|show|see|what is)\b/i.test(spoken)) return null;
  let subject = spoken.match(/\bwhat\s+(?:does|would|do)\s+(.+?)\s+look\s+like\b/i)?.[1]
    || spoken.match(/\bwhat\s+should\s+(.+?)\s+look\s+like\b/i)?.[1]
    || spoken.match(/\bshow\s+me\s+what\s+(.+?)\s+look(?:s)?\s+like\b/i)?.[1]
    || spoken.match(/\b(?:picture|photo|image|visual)\s+of\s+(.+)/i)?.[1]
    || spoken.match(/\b(?:show\s+me|let\s+me\s+see|what\s+is)\s+(.+)/i)?.[1]
    || '';
  subject = subject.replace(/^(?:a|an|the|some)\s+/i, '')
    .replace(/^(?:picture|photo|image|visual)\s+(?:of\s+)?/i, '')
    .replace(/\s+(?:look(?:s)?\s+like|please)$/i, '').trim();
  if (!subject) return null;
  const dish = /^(?:(?:this|the|selected|current|finished)\s+)?(?:dish|recipe|meal|food|it)$/i.test(subject)
    || recipe.title.toLowerCase().includes(subject.toLowerCase());
  if (dish) return { kind: 'image', query: recipe.title, recipeImage: true };
  if (/^pan$/i.test(subject)) subject = recipe.equipment.find(item => /pan|skillet|pot/i.test(item)) || 'cooking pan';
  return { kind: 'image', query: subject.split(/\s+/).slice(0, 7).join(' ').slice(0, 120) };
}

export function videoEmbedUrl(video) {
  try {
    const url = new URL(video.url);
    if (video.platform === 'youtube' && url.hostname === 'www.youtube.com') {
      const id = url.pathname.match(/^\/shorts\/([\w-]+)\/?$/)?.[1];
      return id ? `https://www.youtube.com/embed/${id}?playsinline=1` : null;
    }
    if (video.platform === 'instagram' && url.hostname === 'www.instagram.com') {
      const id = url.pathname.match(/^\/reel\/([\w-]+)\/?$/)?.[1];
      return id ? `https://www.instagram.com/p/${id}/embed/captioned/` : null;
    }
    if (video.platform === 'tiktok' && url.hostname === 'www.tiktok.com') {
      const id = url.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/)?.[1];
      return id ? `https://www.tiktok.com/player/v1/${id}?autoplay=0&controls=1&muted=0&volume_control=1` : null;
    }
  } catch { /* Ignore invalid links. */ }
  return null;
}

let youtubeApiPromise;
function youtubePlayerApi() {
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  if (!youtubeApiPromise) youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = globalThis.onYouTubeIframeAPIReady;
    const timeout = setTimeout(() => reject(new Error('YouTube player API did not load')), 10000);
    globalThis.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      previousReady?.();
      resolve(globalThis.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timeout); reject(new Error('YouTube player API was blocked')); };
    document.head.append(script);
  }).catch(error => { youtubeApiPromise = null; throw error; });
  return youtubeApiPromise;
}

function closeInlineVideo(state, { resumeSpeech = true } = {}) {
  const root = $('visual-results-content');
  $('visual-results').classList.remove('is-playing');
  let speakingAfterVideo = false;
  if (state.videoMessageHandler) {
    window.removeEventListener('message', state.videoMessageHandler);
    state.videoMessageHandler = null;
  }
  const stage = root.querySelector('.inline-video-stage');
  const hadVideo = stage && !stage.hidden;
  if (stage) { stage.replaceChildren(); stage.hidden = true; }
  const playing = root.querySelector('.video-play[aria-pressed="true"]');
  if (playing) {
    playing.setAttribute('aria-pressed', 'false');
    playing.textContent = 'Play here';
  }
  if (state.session && !state.session.closed) {
    state.session.videoPlaying = false;
    state.session.chunks = [];
    state.session.count = 0;
    state.session.context?.resume().catch(() => {});
    if (resumeSpeech && state.session.pendingCookingAudio) {
      const audio = state.session.pendingCookingAudio;
      state.session.pendingCookingAudio = null;
      state.session.speaking = true;
      speakingAfterVideo = true;
      audio.play().catch(() => {
        if (!state.session?.closed) state.session.speaking = false;
      });
    }
  }
  if (state.active && hadVideo) $('cooking-status').textContent = speakingAfterVideo
    ? 'Gusteau is speaking — listening resumes afterward'
    : state.session?.muted ? 'Microphone muted — press Unmute mic to resume'
      : 'Listening — ask a question or say done';
}

function openVisualPanel(title) {
  $('visual-results-title').textContent = title;
  $('visual-results').classList.add('is-open');
  $('visual-results').setAttribute('aria-hidden', 'false');
  $('visual-results').inert = false;
  $('visual-results-close').focus({ preventScroll: true });
}

function closeVisualPanel(state) {
  state.visualRequestId++;
  closeInlineVideo(state);
  const drawer = $('visual-results');
  if (!drawer.classList.contains('is-open')) return;
  if (drawer.contains(document.activeElement)) $('cooking-status').focus({ preventScroll: true });
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.inert = true;
}

async function loadTechniqueVideos(state, query) {
  const root = $('visual-results-content');
  const stepKey = $('step-visuals').dataset.stepKey;
  const requestId = ++state.visualRequestId;
  closeInlineVideo(state);
  root.replaceChildren();
  openVisualPanel('Technique videos');
  let panel = root.querySelector('.technique-videos');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'technique-videos';
    root.append(panel);
  }
  panel.replaceChildren();
  const heading = document.createElement('h4');
  heading.textContent = 'Short videos for this technique';
  const status = document.createElement('p');
  status.className = 'muted';
  status.textContent = `Searching for “${query}”…`;
  panel.append(heading, status);
  try {
    const response = await fetch(`/api/technique-videos?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(`Search returned ${response.status}`);
    const videos = await response.json();
    if (state.visualRequestId !== requestId || $('step-visuals').dataset.stepKey !== stepKey) return;
    status.remove();
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = 'YouTube and TikTok resume listening when a clip ends. Use Resume listening to stop early or after an Instagram reel.';
    panel.append(hint);
    const stage = document.createElement('div');
    stage.className = 'inline-video-stage';
    stage.hidden = true;
    panel.append(stage);
    const grid = document.createElement('div');
    grid.className = 'video-results';
    const failedYouTubeVideos = new Set();
    const playYouTube = new Map();
    for (const [id, label, icon] of [
      ['youtube', 'YouTube Shorts', '▶'], ['instagram', 'Instagram Reels', '◎'], ['tiktok', 'TikTok', '♪'],
    ]) {
      const group = document.createElement('div');
      group.className = 'video-group';
      const title = document.createElement('h5');
      title.textContent = label;
      group.append(title);
      const matches = videos.filter(video => video.platform === id);
      for (const video of matches) {
        const card = document.createElement('div');
        card.className = 'video-result';
        const media = document.createElement('button');
        media.type = 'button';
        media.className = 'video-thumbnail';
        media.setAttribute('aria-label', `Play ${video.title} here`);
        const embed = videoEmbedUrl(video);
        const fallbackPreview = () => {
          if (id === 'tiktok' && embed) {
            const frame = document.createElement('iframe');
            const previewUrl = new URL(embed);
            previewUrl.searchParams.set('autoplay', '0');
            previewUrl.searchParams.set('muted', '1');
            previewUrl.searchParams.set('controls', '0');
            frame.src = previewUrl.href;
            frame.className = 'video-preview-frame';
            frame.loading = 'lazy';
            frame.tabIndex = -1;
            frame.setAttribute('aria-hidden', 'true');
            media.append(frame);
            return;
          }
          const tile = document.createElement('span');
          tile.className = `video-tile video-tile-${id}`;
          tile.textContent = icon;
          tile.setAttribute('aria-hidden', 'true');
          media.append(tile);
        };
        if (video.thumbnail) {
          const thumbnail = document.createElement('img');
          thumbnail.src = id === 'tiktok'
            ? `/api/video-thumbnail?url=${encodeURIComponent(video.thumbnail)}` : video.thumbnail;
          thumbnail.alt = '';
          thumbnail.loading = 'lazy';
          thumbnail.addEventListener('error', () => {
            thumbnail.remove();
            fallbackPreview();
          });
          media.append(thumbnail);
        } else fallbackPreview();
        card.append(media);
        const caption = document.createElement('span');
        caption.className = 'video-title';
        caption.textContent = video.title;
        card.append(caption);
        const controls = document.createElement('div');
        controls.className = 'video-controls';
        if (embed) {
          const play = document.createElement('button');
          play.type = 'button';
          play.className = 'video-play';
          play.textContent = 'Play here';
          play.setAttribute('aria-pressed', 'false');
          const toggleVideo = () => {
            if (play.getAttribute('aria-pressed') === 'true') {
              closeInlineVideo(state);
              return;
            }
            closeInlineVideo(state, { resumeSpeech: false });
            $('cooking-audio').pause();
            if (state.session && !state.session.closed) {
              state.session.speaking = false;
              state.session.videoPlaying = true;
            }
            if (state.active) $('cooking-status').textContent = 'Watching a video — listening will resume when it ends';
            $('visual-results').classList.add('is-playing');
            stage.hidden = false;
            const playerHeading = document.createElement('div');
            playerHeading.className = 'inline-player-heading';
            const playerTitle = document.createElement('strong');
            playerTitle.textContent = `${label}: ${video.title}`;
            const close = document.createElement('button');
            close.type = 'button';
            close.textContent = 'Resume listening';
            close.addEventListener('click', () => closeInlineVideo(state));
            const direct = document.createElement('a');
            direct.href = video.url;
            direct.target = '_blank';
            direct.rel = 'noopener noreferrer';
            direct.textContent = 'Pop out ↗';
            playerHeading.append(playerTitle, direct, close);
            const frame = document.createElement('iframe');
            const playerUrl = new URL(embed);
            if (id === 'youtube') {
              playerUrl.searchParams.set('enablejsapi', '1');
              playerUrl.searchParams.set('origin', location.origin);
            }
            frame.src = playerUrl.href;
            frame.title = `${label}: ${video.title}`;
            frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; web-share';
            frame.allowFullscreen = true;
            frame.referrerPolicy = 'strict-origin-when-cross-origin';
            const playbackHint = document.createElement('p');
            playbackHint.className = 'muted';
            playbackHint.textContent = id === 'instagram'
              ? 'Press play in the reel. Instagram may omit sound from embeds; use Pop out if there is no speaker control.'
              : id === 'tiktok'
                ? 'Press play in the TikTok player. Use its speaker control if sound is off.'
                : 'Press play in the YouTube player to start with sound.';
            stage.append(playerHeading, playbackHint, frame);
            if (id === 'tiktok') {
              state.videoMessageHandler = event => {
                if (event.origin !== 'https://www.tiktok.com' || event.source !== frame.contentWindow) return;
                let message = event.data;
                if (typeof message === 'string') {
                  try { message = JSON.parse(message); } catch { return; }
                }
                if (message?.type !== 'onStateChange') return;
                if (message.value === 0) closeInlineVideo(state);
                else if (state.session && !state.session.closed) {
                  state.session.videoPlaying = message.value === 1 || message.value === 3;
                  if (!state.session.videoPlaying) state.session.context?.resume().catch(() => {});
                }
              };
              window.addEventListener('message', state.videoMessageHandler);
            }
            if (id === 'youtube') youtubePlayerApi().then(YT => {
              if (!frame.isConnected) return;
              new YT.Player(frame, { events: { onStateChange: event => {
                if (!frame.isConnected) return;
                if (event.data === YT.PlayerState.ENDED) closeInlineVideo(state);
                else if (state.session && !state.session.closed) {
                  state.session.videoPlaying = event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.BUFFERING;
                  if (!state.session.videoPlaying) state.session.context?.resume().catch(() => {});
                }
              }, onError: event => {
                if (!frame.isConnected) return;
                failedYouTubeVideos.add(video.url);
                const next = matches.find(candidate => !failedYouTubeVideos.has(candidate.url));
                if (next && playYouTube.has(next.url)) {
                  playbackHint.textContent = 'This Short cannot play here. Trying another…';
                  playYouTube.get(next.url)();
                  return;
                }
                playbackHint.textContent = event.data === 153
                  ? 'YouTube error 153: this browser did not identify the embedded player. Use Pop out to watch it.'
                  : `YouTube error ${event.data}: this Short cannot play here. Use Pop out to watch it.`;
              } } });
            }).catch(() => { /* The native player remains usable without API diagnostics. */ });
            play.setAttribute('aria-pressed', 'true');
            play.textContent = 'Close video';
            root.scrollTo({ top: root.scrollTop + stage.getBoundingClientRect().top - root.getBoundingClientRect().top,
              behavior: 'smooth' });
          };
          play.addEventListener('click', toggleVideo);
          media.addEventListener('click', toggleVideo);
          if (id === 'youtube') playYouTube.set(video.url, toggleVideo);
          controls.append(play);
        } else {
          media.addEventListener('click', () => window.open(video.url, '_blank', 'noopener,noreferrer'));
          media.setAttribute('aria-label', `Open ${video.title}`);
        }
        const popout = document.createElement('a');
        popout.href = video.url;
        popout.target = '_blank';
        popout.rel = 'noopener noreferrer';
        popout.textContent = 'Pop out ↗';
        popout.addEventListener('click', () => closeInlineVideo(state));
        controls.append(popout);
        card.append(controls);
        group.append(card);
      }
      if (!matches.length) {
        const fallback = document.createElement('a');
        fallback.href = id === 'youtube'
          ? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${query} cooking recipe shorts`)}`
          : id === 'instagram'
            ? `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(`${query} cooking recipe reel`)}`
            : `https://www.tiktok.com/search/video?q=${encodeURIComponent(`${query} cooking recipe`)}`;
        fallback.target = '_blank';
        fallback.rel = 'noopener noreferrer';
        fallback.textContent = `Search ${label} ↗`;
        group.append(fallback);
      }
      grid.append(group);
    }
    panel.append(grid);
  } catch {
    if (state.visualRequestId === requestId && $('step-visuals').dataset.stepKey === stepKey) {
      status.textContent = 'Video search is unavailable right now. Please try again later.';
    }
  }
}

async function loadAppearanceImages(state, request) {
  const root = $('visual-results-content');
  const stepKey = $('step-visuals').dataset.stepKey;
  const requestId = ++state.visualRequestId;
  closeInlineVideo(state);
  root.replaceChildren();
  openVisualPanel('Images');
  let panel = root.querySelector('.appearance-images');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'appearance-images';
    root.append(panel);
  }
  panel.replaceChildren();
  const heading = document.createElement('h4');
  heading.textContent = `Images of ${request.query}`;
  const status = document.createElement('p');
  status.className = 'muted';
  status.textContent = 'Finding images…';
  panel.append(heading, status);
  try {
    let images;
    if (request.recipeImage && state.recipe.image?.file) {
      images = [{ title: state.recipe.title,
        thumbnail: `/api/recipe-images/${encodeURIComponent(state.recipe.image.file)}`,
        source: state.recipe.image.sourceUrl || null }];
    } else {
      const response = await fetch(`/api/visual-images?q=${encodeURIComponent(request.query)}`);
      if (!response.ok) throw new Error(`Image search returned ${response.status}`);
      images = await response.json();
    }
    if (state.visualRequestId !== requestId || $('step-visuals').dataset.stepKey !== stepKey) return;
    status.remove();
    if (!images.length) {
      status.textContent = `No images found for “${request.query}”.`;
      panel.append(status);
      return;
    }
    const gallery = document.createElement('div');
    gallery.className = 'appearance-gallery';
    for (const image of images) {
      const figure = document.createElement('figure');
      const photo = document.createElement('img');
      photo.src = image.thumbnail;
      photo.alt = image.title;
      photo.loading = 'lazy';
      photo.addEventListener('error', () => figure.remove());
      const caption = document.createElement('figcaption');
      caption.textContent = image.title;
      figure.append(photo, caption);
      if (image.source) {
        const source = document.createElement('a');
        source.href = image.source;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = 'Image source ↗';
        figure.append(source);
      }
      gallery.append(figure);
    }
    panel.append(gallery);
  } catch {
    if (state.visualRequestId === requestId && $('step-visuals').dataset.stepKey === stepKey) {
      status.textContent = 'Image search is unavailable right now.';
    }
  }
}

export function alignVisualReply(reply, visual) {
  if (!visual || !/\b(?:can(?:not|'t)|unable to|do not have the ability to|don't have the ability to)\s+(?:show|display|provide|pull up|access)\b/i.test(reply)) return reply;
  return visual.kind === 'video'
    ? `I'm opening short videos for ${visual.query} in the visual panel. I can talk you through it too.`
    : `I'm opening images of ${visual.query} in the visual panel. Tell me what detail you want to check.`;
}

export async function askChef(state, transcript, signal, visual) {
  const recipe = state.recipe;
  const response = await fetch('/ollama/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: 'qwen3.6:35b-mlx', stream: false, think: false, keep_alive: '30m',
      format: RESPONSE_SCHEMA,
      options: { temperature: 0.15, num_predict: 900, num_ctx: 8192 },
      messages: [
        { role: 'system', content: `You are Gusteau, a practical cooking companion. You have the complete selected recipe below. The application owns the current step and only advances after the cook explicitly says they completed it. Classify the user's utterance as ready (wants to begin), done (explicitly finished the current step), question (asks for explanation or guidance), change (ingredient, cookware, timing, or other kitchen change), or repeat (asks to repeat the current step). Never infer that a step is complete from a question or a change. If the cook says they are not ready, do not choose ready. For questions or changes, answer accurately using the recipe and current step; ask one concise clarification if needed. Treat kitchenNotes as the cook's current situation and adapt advice accordingly. When the cook states a definite ingredient substitution, choose change and fill substitution: originalIngredient must exactly match one current recipe.ingredients entry, revisedIngredient is the complete replacement line including quantity, revisedSteps contains each affected step as its full revised instruction with 1-based stepNumber, and note briefly states what was substituted and any practical effect. Preserve unrelated ingredients, step details, times, and safety instructions. If the swap is ambiguous, ask for clarification and leave substitution fields empty. For non-ingredient changes, leave substitution fields empty. For a different pan, explain the likely adjustment but do not claim the original instructions have changed. In particular, do not recommend heating a nonstick pan until it smokes or using high heat on it. The application can search for images and short videos and opens them in a visual panel; visualSupport tells you when that is happening. Never claim you cannot show images or videos when visualSupport is present. Acknowledge the panel briefly, then answer the cooking question in words. Do not claim a particular result was found before search completes. Keep reply to one or two short, speakable sentences, without Markdown. Use note only for a concrete kitchen fact the cook supplied that should be remembered; otherwise use an empty string. Do not claim to have verified doneness, allergens, or safe temperatures by observation. Return only JSON matching the schema.` },
        { role: 'user', content: JSON.stringify({
          recipe: {
            title: recipe.title, description: recipe.description, servings: recipe.servings,
            ingredients: recipe.ingredients, steps: recipe.steps, equipment: recipe.equipment,
            allergens: recipe.allergens,
          },
          phase: state.phase,
          currentStep: state.phase === 'cooking' ? state.stepIndex + 1 : null,
          currentInstruction: state.phase === 'cooking' ? recipe.steps[state.stepIndex] : null,
          kitchenNotes: state.notes,
          substitutionNotes: recipe.adjustments || [],
          recentConversation: state.history.slice(-8),
          visualSupport: visual ? { kind: visual.kind, query: visual.query, status: 'searching in the visual panel' } : null,
          userUtterance: transcript,
        }) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const result = JSON.parse(data.message?.content || '{}');
  if (!RESPONSE_SCHEMA.properties.action.enum.includes(result.action) || typeof result.reply !== 'string') {
    throw new Error('Ollama returned an incomplete conversation response');
  }
  if (typeof result.note !== 'string') result.note = '';
  if (!result.substitution || typeof result.substitution !== 'object') result.substitution = null;
  return result;
}

export function initCooking({ startMic, stopMic, synthesize, setAudio }) {
  const state = { catalog: [], recipe: null, baseRecipe: null, active: false, session: null, phase: 'waiting',
    stepIndex: -1, notes: [], history: [], busy: false, visualRequestId: 0,
    responseId: 0, responseController: null, timers: [], timerInterval: null, timerAudio: null };
  const setStatus = value => { $('cooking-status').textContent = state.session?.muted && value.startsWith('Listening')
    ? 'Microphone muted — press Unmute mic to resume' : value; };
  const setError = value => { $('cooking-error').textContent = value; };
  const showInterrupt = visible => {
    $('cooking-interrupt').hidden = !visible;
    $('cooking-interrupt').disabled = !visible;
  };

  function beepTimer(reminder = false) {
    const context = state.timerAudio;
    if (!context) return;
    context.resume().then(() => {
      const offsets = reminder ? [0, .18, .36] : [0, .28, .56];
      const length = reminder ? .11 : .22;
      for (const offset of offsets) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = reminder ? 1050 : 880;
        gain.gain.setValueAtTime(.0001, context.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(.2, context.currentTime + offset + .02);
        gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + offset + length);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(context.currentTime + offset);
        oscillator.stop(context.currentTime + offset + length + .02);
      }
    }).catch(() => {});
  }

  function renderTimers() {
    const offers = $('timer-offers');
    const running = $('timer-running');
    offers.replaceChildren();
    running.replaceChildren();
    const activeStep = state.phase === 'cooking' ? state.stepIndex : -1;
    const available = activeStep >= 0 && activeStep < state.recipe?.steps.length
      ? stepTimers(state.recipe.steps[activeStep]) : [];
    for (const [index, timer] of available.entries()) {
      const key = `${activeStep}:${index}`;
      if (state.timers.some(item => item.key === key)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Start ${timer.label} timer`;
      button.addEventListener('click', () => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass && !state.timerAudio) state.timerAudio = new AudioContextClass();
        state.timerAudio?.resume().catch(() => {});
        state.timers.push({ key, step: activeStep + 1, label: timer.label,
          durationSeconds: timer.seconds, reminded: false,
          deadline: Date.now() + timer.seconds * 1000 });
        $('timer-alert').textContent = '';
        if (!state.timerInterval) state.timerInterval = setInterval(tickTimers, 1000);
        renderTimers();
      });
      offers.append(button);
    }
    for (const timer of state.timers) {
      const row = document.createElement('div');
      row.className = 'timer-row';
      const label = document.createElement('span');
      label.textContent = `Step ${timer.step} · ${timer.label}: ${timerClock((timer.deadline - Date.now()) / 1000)} left`;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.setAttribute('aria-label', `Cancel step ${timer.step} ${timer.label} timer`);
      cancel.addEventListener('click', () => {
        state.timers = state.timers.filter(item => item !== timer);
        if (!state.timers.length) { clearInterval(state.timerInterval); state.timerInterval = null; }
        renderTimers();
      });
      row.append(label, cancel);
      running.append(row);
    }
    $('cooking-timers').hidden = !available.length && !state.timers.length && !$('timer-alert').textContent;
  }

  function tickTimers() {
    const now = Date.now();
    const expired = state.timers.filter(timer => timerSignal(timer, now) === 'finished');
    const reminders = state.timers.filter(timer => timerSignal(timer, now) === 'reminder');
    for (const timer of reminders) timer.reminded = true;
    if (reminders.length) {
      $('timer-alert').textContent = reminders.map(timer => `Step ${timer.step} timer: 30 seconds left.`).join(' ');
      beepTimer(true);
    }
    if (expired.length) {
      state.timers = state.timers.filter(timer => timerSignal(timer, now) !== 'finished');
      $('timer-alert').textContent = expired.map(timer => `Step ${timer.step} timer finished: ${timer.label}.`).join(' ');
      beepTimer();
    }
    if (!state.timers.length) { clearInterval(state.timerInterval); state.timerInterval = null; }
    renderTimers();
  }

  function clearTimers() {
    state.timers = [];
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    $('timer-alert').textContent = '';
    renderTimers();
  }

  function setControls(active) {
    $('genre').disabled = active;
    $('recipe-select').disabled = active;
    $('cooking-start').disabled = active || !state.recipe;
    $('cooking-stop').hidden = !active;
    $('cooking-stop').disabled = !active;
    showInterrupt(false);
    $('cooking-mute').hidden = !active;
    $('cooking-mute').disabled = !active;
    $('cooking-mute').textContent = 'Mute mic';
    $('cooking-mute').setAttribute('aria-pressed', 'false');
    $('start').disabled = active;
  }

  function beginResponse() {
    state.responseController?.abort();
    state.responseController = new AbortController();
    showInterrupt(false);
    return ++state.responseId;
  }

  function interruptResponse() {
    if (!state.active || !state.session || state.session.closed) return;
    state.responseController?.abort();
    state.responseController = null;
    state.responseId++;
    state.busy = false;
    const session = state.session;
    session.pendingCookingAudio = null;
    const audio = $('cooking-audio');
    audio.pause();
    audio.onplay = null;
    audio.onpause = null;
    audio.onended = null;
    if (audio.dataset.objectUrl) {
      URL.revokeObjectURL(audio.dataset.objectUrl);
      delete audio.dataset.objectUrl;
    }
    audio.removeAttribute('src');
    audio.load();
    audio.style.display = 'none';
    session.speaking = false;
    session.chunks = [];
    session.count = 0;
    session.draft = '';
    session.finalized = true;
    session.lastVoice = 0;
    session.context?.resume().catch(() => {});
    showInterrupt(false);
    setStatus('Listening — go ahead and correct me');
  }

  async function loadRecipes() {
    try {
      const response = await fetch('/api/recipes');
      if (!response.ok) throw new Error(`Recipe catalog returned ${response.status}`);
      state.catalog = await response.json();
      const genres = [...new Set(state.catalog.map(recipe => recipe.genre))].sort();
      $('genre').replaceChildren();
      for (const genre of genres) {
        const option = document.createElement('option');
        option.value = genre;
        option.textContent = genre[0].toUpperCase() + genre.slice(1);
        $('genre').append(option);
      }
      $('genre').disabled = false;
      await chooseGenre();
    } catch (error) {
      setError(`Could not load recipes: ${error.message}`);
      setStatus('Recipe library unavailable');
    }
  }

  async function chooseGenre() {
    const genre = $('genre').value;
    const matches = state.catalog.filter(recipe => recipe.genre === genre)
      .sort((a, b) => a.title.localeCompare(b.title));
    $('recipe-select').replaceChildren();
    for (const recipe of matches) {
      const option = document.createElement('option');
      option.value = recipe.id;
      option.textContent = recipe.chef?.name ? `${recipe.title} — ${recipe.chef.name}` : recipe.title;
      $('recipe-select').append(option);
    }
    $('recipe-select').disabled = false;
    await chooseRecipe();
  }

  async function chooseRecipe() {
    const id = $('recipe-select').value;
    clearTimers();
    state.phase = 'waiting';
    state.stepIndex = -1;
    state.recipe = null;
    state.baseRecipe = null;
    closeVisualPanel(state);
    renderStepVisuals(null, -1);
    $('cooking-start').disabled = true;
    setStatus('Loading recipe');
    try {
      const response = await fetch(`/api/recipes/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(`Recipe returned ${response.status}`);
      const recipe = await response.json();
      if (id !== $('recipe-select').value) return;
      state.baseRecipe = recipe;
      state.recipe = structuredClone(recipe);
      renderRecipe(recipe);
      renderTimers();
      setStatus('Ready to start');
      $('cooking-start').disabled = false;
      setError('');
    } catch (error) {
      setError(`Could not load recipe: ${error.message}`);
      setStatus('Recipe unavailable');
    }
  }

  async function speak(session, text, responseId) {
    session.speaking = true;
    session.chunks = [];
    session.count = 0;
    addLine('Gusteau', text);
    state.history.push({ role: 'assistant', content: text });
    setStatus('Generating Gusteau’s voice');
    try {
      const speech = await synthesize(text, $('cooking-voice').value, state.responseController?.signal);
      if (!state.active || state.session !== session || session.closed || state.responseId !== responseId) return;
      const audio = setAudio('cooking-audio', speech);
      audio.onplay = () => {
        if (state.responseId !== responseId || session.closed) return;
        session.speaking = true;
        showInterrupt(true);
        setStatus('Gusteau is speaking');
      };
      audio.onpause = () => {
        if (state.responseId !== responseId || audio.ended || session.closed) return;
        showInterrupt(false);
        if (session.videoPlaying) return;
        session.speaking = false;
        setStatus('Listening — ask a question or say done');
      };
      audio.onended = () => {
        if (state.session !== session || session.closed || state.responseId !== responseId) return;
        session.speaking = false;
        showInterrupt(false);
        setStatus(state.phase === 'finished' ? 'Recipe complete' : 'Listening — ask a question or say done');
      };
      if (session.videoPlaying) {
        session.pendingCookingAudio = audio;
        session.speaking = false;
        setStatus('Watching a video — Gusteau will speak when it ends');
        return;
      }
      try { await audio.play(); }
      catch {
        if (state.responseId !== responseId) return;
        session.speaking = false;
        showInterrupt(false);
        setStatus('Press play below to hear Gusteau, then speak');
      }
    } catch (error) {
      if (state.session !== session || session.closed || state.responseId !== responseId) return;
      session.speaking = false;
      showInterrupt(false);
      setError(`Speech generation failed: ${error.message}`);
      setStatus('Listening');
    }
  }

  async function onTranscript(session, transcript) {
    if (!state.active || state.session !== session || state.busy || session.closed || !transcript.trim()) return;
    const responseId = beginResponse();
    state.busy = true;
    session.speaking = true;
    session.chunks = [];
    session.count = 0;
    $('cooking-heard').textContent = transcript;
    addLine('You', transcript);
    setStatus('Gusteau is thinking');
    const visual = visualRequest(transcript, state.recipe, Math.max(state.stepIndex, 0));
    if (visual) {
      renderStepVisuals(state.recipe, Math.max(state.stepIndex, 0));
      if (visual.kind === 'image') loadAppearanceImages(state, visual);
      else loadTechniqueVideos(state, visual.query);
    }
    try {
      const result = await askChef(state, transcript, state.responseController.signal, visual);
      if (!state.active || state.session !== session || session.closed || state.responseId !== responseId) return;
      state.history.push({ role: 'user', content: transcript });
      if (result.action === 'change') {
        const applied = applyIngredientSubstitution(state.recipe, result.substitution);
        if (applied) {
          state.recipe = applied.recipe;
          state.recipe.adjustments = [...(state.recipe.adjustments || []), applied.note];
          state.notes.push(applied.note);
        } else if (result.note.trim()) state.notes.push(result.note.trim().slice(0, 220));
      }
      let answer = alignVisualReply(result.reply.trim() || 'Could you say that another way?', visual);
      if (result.action === 'ready' && state.phase === 'waiting') {
        state.phase = 'cooking';
        state.stepIndex = 0;
        answer = `Great, let's begin. Step 1 of ${state.recipe.steps.length}: ${state.recipe.steps[0]} Tell me when you finish this step.`;
      } else if (result.action === 'done' && state.phase === 'cooking') {
        state.stepIndex++;
        if (state.stepIndex >= state.recipe.steps.length) {
          state.phase = 'finished';
          answer = `That's the final step. Your ${state.recipe.title} is ready. Well done!`;
        } else {
          answer = `Nice work. Step ${state.stepIndex + 1} of ${state.recipe.steps.length}: ${state.recipe.steps[state.stepIndex]} Tell me when you're done.`;
        }
      } else if (result.action === 'repeat' && state.phase === 'cooking') {
        answer = `Step ${state.stepIndex + 1}: ${state.recipe.steps[state.stepIndex]}`;
      } else if (state.phase === 'waiting' && result.action === 'done') {
        answer = 'We have not started yet. Say “ready” when you want to begin.';
      }
      renderRecipe(state.recipe, state.stepIndex);
      renderTimers();
      const visualStepIndex = state.phase === 'cooking' ? state.stepIndex : visual ? 0 : -1;
      if (visualStepIndex < 0 || $('step-visuals').dataset.stepKey !== `${state.recipe.id}:${visualStepIndex}`) closeVisualPanel(state);
      renderStepVisuals(state.recipe, visualStepIndex);
      await speak(session, answer, responseId);
    } catch (error) {
      if (state.session !== session || session.closed || state.responseId !== responseId) return;
      session.speaking = false;
      showInterrupt(false);
      setError(`Culinary assistant failed: ${error.message}`);
      setStatus('Listening — please try again');
    } finally {
      if (state.responseId === responseId) state.busy = false;
    }
  }

  async function startConversation() {
    if (!state.recipe || state.active) return;
    clearTimers();
    state.recipe = structuredClone(state.baseRecipe);
    renderRecipe(state.recipe);
    state.active = true;
    state.phase = 'waiting';
    state.stepIndex = -1;
    renderTimers();
    state.notes = [];
    state.history = [];
    state.busy = false;
    $('cooking-history').replaceChildren();
    $('cooking-heard').textContent = '—';
    closeVisualPanel(state);
    renderStepVisuals(null, -1);
    setError('');
    setControls(true);
    setStatus('Connecting microphone');
    const session = await startMic(created => { state.session = created; });
    if (!state.active) return;
    if (!session) {
      state.active = false;
      setControls(false);
      setStatus('Could not start microphone');
      return;
    }
    state.session = session;
  }

  function onConnected(session) {
    if (!state.active || state.session !== session || session.greeted) return;
    session.greeted = true;
    const responseId = beginResponse();
    speak(session, `Hello! I’m Gusteau. We’re making ${state.recipe.title}. I have the ingredients and recipe steps ready. Tell me when you’re ready to start.`, responseId);
  }

  function onStopped(session) {
    if (state.session !== session) return;
    state.responseController?.abort();
    state.responseController = null;
    state.responseId++;
    session.pendingCookingAudio = null;
    $('cooking-audio').pause();
    closeVisualPanel(state);
    state.active = false;
    state.session = null;
    state.busy = false;
    setControls(false);
    setStatus('Conversation ended');
  }

  function onMuted(session, muted) {
    if (state.session !== session || !state.active) return;
    $('cooking-mute').textContent = muted ? 'Unmute mic' : 'Mute mic';
    $('cooking-mute').setAttribute('aria-pressed', String(muted));
    if (!session.speaking && !state.busy) setStatus(muted
      ? 'Microphone muted — press Unmute mic to resume'
      : 'Listening — ask a question or say done');
  }

  $('genre').addEventListener('change', chooseGenre);
  $('recipe-select').addEventListener('change', chooseRecipe);
  $('cooking-start').addEventListener('click', startConversation);
  $('cooking-interrupt').addEventListener('click', interruptResponse);
  $('cooking-stop').addEventListener('click', stopMic);
  $('visual-results-close').addEventListener('click', () => closeVisualPanel(state));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('visual-results').classList.contains('is-open')) closeVisualPanel(state);
  });
  loadRecipes();

  return { onConnected, onTranscript, onStopped, onMuted, hasRecipe: () => !!state.recipe };
}
