import test from 'node:test';
import assert from 'node:assert/strict';
import { alignVisualReply, videoEmbedUrl, videoQuery, visualRequest } from './cooking.js';
import { allowedTikTokThumbnailUrl, cookingSearchPhrase, parseVideoResults, parseYouTubeResults, tiktokPageThumbnail } from './video-search.js';
import { imageSearchQueries, parseCommonsImages } from './visual-images.js';

test('adds cooking context to web searches without changing the requested subject', () => {
  assert.equal(cookingSearchPhrase('dice an onion'), 'dice an onion cooking recipe');
  assert.equal(cookingSearchPhrase('cooking onions for a recipe'), 'cooking onions for a recipe');
  assert.deepEqual(imageSearchQueries('cast iron skillet'), [
    'intitle:"cast iron skillet" cooking', 'intitle:"cast iron skillet" recipe', 'intitle:"cast iron skillet"',
  ]);
});

test('uses the spoken technique or the current step for a visual request', () => {
  const recipe = { steps: ['Mince the garlic, then warm it in olive oil.'] };
  assert.equal(videoQuery('Can you show me how to mince garlic?', recipe, 0), 'mince garlic');
  assert.equal(videoQuery('Could you pull up a short video showing how to mince garlic?', recipe, 0), 'mince garlic');
  assert.equal(videoQuery('Show me how to do this.', recipe, 0), 'Mince the garlic');
  assert.equal(videoQuery('Show me how I can dice an onion', recipe, 0), 'dice an onion');
  assert.equal(videoQuery('Why do we warm the oil?', recipe, 0), '');
});

test('routes appearance questions to images and technique questions to videos', () => {
  const recipe = { title: 'Chicken and Dumplings', steps: ['Dice the onion.'], equipment: ['cast iron skillet'] };
  assert.deepEqual(visualRequest('Show me how I can dice an onion', recipe, 0),
    { kind: 'video', query: 'dice an onion' });
  assert.deepEqual(visualRequest('What does a cast iron skillet look like?', recipe, 0),
    { kind: 'image', query: 'cast iron skillet' });
  assert.deepEqual(visualRequest('Show me a picture of a shallot', recipe, 0),
    { kind: 'image', query: 'shallot' });
  assert.deepEqual(visualRequest('What does the dish look like?', recipe, 0),
    { kind: 'image', query: 'Chicken and Dumplings', recipeImage: true });
  assert.deepEqual(visualRequest('What should a diced onion look like?', recipe, 0),
    { kind: 'image', query: 'diced onion' });
  assert.equal(visualRequest('Why do we warm the oil?', recipe, 0), null);
});

test('matches spoken visual replies to the panel opened by the UI', () => {
  assert.match(alignVisualReply('I cannot show images.', { kind: 'image', query: 'shallots' }), /opening images of shallots/);
  assert.match(alignVisualReply("I can't show videos.", { kind: 'video', query: 'dice an onion' }), /opening short videos for dice an onion/);
  assert.equal(alignVisualReply('Cut the onion into even pieces.', { kind: 'video', query: 'dice an onion' }), 'Cut the onion into even pieces.');
});

test('finds a TikTok cover in page metadata when oEmbed has none', () => {
  assert.equal(tiktokPageThumbnail('<meta property="og:image" content="https://p16.tiktokcdn.com/cover.jpg?x=1&amp;y=2">'),
    'https://p16.tiktokcdn.com/cover.jpg?x=1&y=2');
  assert.equal(tiktokPageThumbnail('<meta property="og:image" content="javascript:bad">'), null);
  assert.equal(allowedTikTokThumbnailUrl('https://p16-sign-va.tiktokcdn.com/cover.jpeg'),
    'https://p16-sign-va.tiktokcdn.com/cover.jpeg');
  assert.equal(allowedTikTokThumbnailUrl('https://tiktokcdn.com.evil.example/cover.jpeg'), null);
});

test('keeps usable Commons photos and prefers concise matching titles', () => {
  const data = { query: { pages: {
    1: { title: 'File:Cast iron skillet.jpg', imageinfo: [{ thumburl: 'https://thumb.wikimedia.org/pan.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cast_iron_skillet.jpg', mime: 'image/jpeg', width: 640, height: 480 }] },
    2: { title: 'File:Cast iron skillet with eggs and toast.jpg', imageinfo: [{ thumburl: 'https://thumb.wikimedia.org/eggs.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cast_iron_skillet_with_eggs.jpg', mime: 'image/jpeg', width: 640, height: 480 }] },
  } } };
  assert.equal(parseCommonsImages(data, 'cast iron skillet')[0].title, 'Cast iron skillet');
});

test('reads direct Shorts from YouTube search data', () => {
  const data = { shelf: [{ shortsLockupViewModel: { accessibilityText: 'How to mince garlic, 2 thousand views - play Short',
    onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'PbKOu401OQk' } } } } }] };
  const html = `<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
  assert.deepEqual(parseYouTubeResults(html), [{
    platform: 'youtube', title: 'How to mince garlic', url: 'https://www.youtube.com/shorts/PbKOu401OQk',
    thumbnail: 'https://i.ytimg.com/vi/PbKOu401OQk/hqdefault.jpg',
  }]);
});

test('keeps only direct video links from the requested platform', () => {
  const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.youtube.com%2Fshorts%2Fabc123">Mince &amp; slice</a>'
    + '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fshorts%2Ffake">Ignore</a>';
  assert.deepEqual(parseVideoResults(html, 'youtube'), [{
    platform: 'youtube', title: 'Mince & slice', url: 'https://www.youtube.com/shorts/abc123',
    thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
  }]);
});

test('builds inline players only for known video URLs', () => {
  assert.equal(videoEmbedUrl({ platform: 'youtube', url: 'https://www.youtube.com/shorts/abc123' }),
    'https://www.youtube.com/embed/abc123?playsinline=1');
  assert.equal(videoEmbedUrl({ platform: 'instagram', url: 'https://www.instagram.com/reel/Dd-fG73IY3P/' }),
    'https://www.instagram.com/p/Dd-fG73IY3P/embed/captioned/');
  assert.equal(videoEmbedUrl({ platform: 'tiktok', url: 'https://www.tiktok.com/@cook/video/7678495417750850829' }),
    'https://www.tiktok.com/player/v1/7678495417750850829?autoplay=0&controls=1&muted=0&volume_control=1');
  assert.equal(videoEmbedUrl({ platform: 'youtube', url: 'https://example.com/shorts/abc123' }), null);
});
