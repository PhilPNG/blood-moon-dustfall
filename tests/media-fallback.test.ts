import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { autoplayNeedsGesture, narrationText, watchFilmProgress } from '../src/components/media-fallback';
import { parseNarrationManifest } from '../shared/narration';

const manifest = parseNarrationManifest(JSON.parse(readFileSync(new URL('../public/media/narration.json', import.meta.url), 'utf8')));
const lobby = manifest.clips.find(clip => clip.id === 'lobby')!;

function pageLifecycle(context: import('node:test').TestContext, hidden = false) {
  const document = Object.assign(new EventTarget(), { hidden });
  const window = new EventTarget();
  for (const [key, value] of [['document', document], ['window', window]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    context.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  return { document, window };
}

test('a backgrounded film keeps its unfinished take and gets a fresh stall deadline when visible', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { document } = pageLifecycle(context);
  let finishes = 0;
  const cleanup = watchFilmProgress({ started: true, paused: false, needsGesture: false }, () => { finishes++; });
  context.mock.timers.tick(5_999);
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  context.mock.timers.tick(30_000);
  assert.equal(finishes, 0, 'background suspension must not be mistaken for a stalled source');
  document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  context.mock.timers.tick(5_999); assert.equal(finishes, 0);
  context.mock.timers.tick(1); assert.equal(finishes, 1, 'a source that still stalls in the foreground remains bounded');
  cleanup();
});

test('pagehide protects the take before document.hidden changes and pageshow restores startup protection', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { window } = pageLifecycle(context);
  let finishes = 0;
  const cleanup = watchFilmProgress({ started: false, paused: false, needsGesture: false }, () => { finishes++; });
  context.mock.timers.tick(4_499);
  window.dispatchEvent(new Event('pagehide'));
  context.mock.timers.tick(30_000); assert.equal(finishes, 0);
  window.dispatchEvent(new Event('pageshow'));
  context.mock.timers.tick(4_499); assert.equal(finishes, 0);
  context.mock.timers.tick(1); assert.equal(finishes, 1);
  cleanup();
});

test('a film mounted in a hidden page waits for visibility before its startup deadline', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { document } = pageLifecycle(context, true);
  let finishes = 0;
  const cleanup = watchFilmProgress({ started: false, paused: false, needsGesture: false }, () => { finishes++; });
  context.mock.timers.tick(30_000); assert.equal(finishes, 0);
  document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  context.mock.timers.tick(4_500); assert.equal(finishes, 1);
  cleanup();
});

test('a delayed deadline checks current visibility even before its lifecycle event is delivered', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { document } = pageLifecycle(context);
  let finishes = 0;
  const cleanup = watchFilmProgress({ started: true, paused: false, needsGesture: false }, () => { finishes++; });
  document.hidden = true;
  context.mock.timers.tick(6_000); assert.equal(finishes, 0);
  cleanup();
});

test('visibility restoration cannot override a game pause or gesture wait or revive a retired take', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { document, window } = pageLifecycle(context);
  let finishes = 0;
  const paused = watchFilmProgress({ started: true, paused: true, needsGesture: false }, () => { finishes++; });
  const gesture = watchFilmProgress({ started: false, paused: false, needsGesture: true }, () => { finishes++; });
  const retired = watchFilmProgress({ started: true, paused: false, needsGesture: false }, () => { finishes++; });
  retired();
  window.dispatchEvent(new Event('pagehide'));
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pageshow'));
  context.mock.timers.tick(30_000);
  assert.equal(finishes, 0, 'returning to a page cannot bypass attention/timer gates or dismiss another take');
  paused(); gesture();
});

test('a permission-blocked film keeps its manual play opportunity beyond startup and stall deadlines', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finishes = 0;
  const cleanup = watchFilmProgress({ started: false, paused: false, needsGesture: autoplayNeedsGesture(new DOMException('A gesture is required', 'NotAllowedError')) }, () => { finishes++; });
  context.mock.timers.tick(30_000);
  assert.equal(finishes, 0, 'waiting for the offered Play film button must not dismiss the story');
  cleanup();
});

test('unsupported or stalled films still time out and a retired deadline cannot end the next take', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(autoplayNeedsGesture(new DOMException('The media source is unavailable', 'NotSupportedError')), false);
  let finishes = 0;
  const stopStartup = watchFilmProgress({ started: false, paused: false, needsGesture: false }, () => { finishes++; });
  context.mock.timers.tick(4_499); assert.equal(finishes, 0);
  context.mock.timers.tick(1); assert.equal(finishes, 1);
  stopStartup();
  const stopStall = watchFilmProgress({ started: true, paused: false, needsGesture: false }, () => { finishes++; });
  context.mock.timers.tick(5_999); assert.equal(finishes, 1);
  context.mock.timers.tick(1); assert.equal(finishes, 2);
  stopStall();
  const stopRetired = watchFilmProgress({ started: false, paused: false, needsGesture: false }, () => { finishes++; });
  stopRetired(); context.mock.timers.tick(30_000); assert.equal(finishes, 2);
});

test('a paused film has no deadline and successful manual playback restores stall protection', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finishes = 0;
  const stopPaused = watchFilmProgress({ started: false, paused: true, needsGesture: false }, () => { finishes++; });
  context.mock.timers.tick(30_000); assert.equal(finishes, 0); stopPaused();
  const stopPlaying = watchFilmProgress({ started: true, paused: false, needsGesture: false }, () => { finishes++; });
  context.mock.timers.tick(6_000); assert.equal(finishes, 1); stopPlaying();
});

test('unavailable narration audio shows one authored translated transcript continuously through cue gaps', () => {
  for (const language of ['es', 'pt-BR'] as const) {
    const beforeGap = narrationText(lobby, 'Welcome to Dustfall. Join on your phone.', language, 1, true);
    const inGap = narrationText(lobby, 'Welcome to Dustfall. Join on your phone.', language, 1.2, true);
    const afterGap = narrationText(lobby, 'Welcome to Dustfall. Join on your phone.', language, 1.4, true);
    assert.equal(beforeGap.text, inGap.text, `${language}: the fallback must stay stable between caption cues`);
    assert.equal(afterGap.text, inGap.text);
    assert.equal(inGap.language, language); assert.equal(inGap.transcript, true);
    assert.ok(inGap.text.includes(language === 'es' ? 'Bienvenidos a Dustfall,' : 'Bem-vindos a Dustfall,'));
    assert.ok(!inGap.text.includes('Welcome to Dustfall'));
  }
});

test('native narration keeps timed captions while CC off stays silent until text fallback is needed', () => {
  assert.deepEqual(narrationText(lobby, 'Fallback', 'pt-BR', 1.2, false), { text: '', language: 'pt-BR', transcript: false });
  assert.equal(narrationText(lobby, 'Fallback', 'pt-BR', 1.4, false).text, 'Bem-vindos a Dustfall,');
  assert.equal(narrationText(lobby, 'Fallback', 'off', 1.4, false).text, '');
  assert.ok(narrationText(lobby, 'Fallback', 'off', 1.2, true).text.includes('Welcome to Dustfall,'));
  assert.deepEqual(narrationText(undefined, 'Fallback in English', 'pt-BR', 0, true), { text: 'Siga as evidências.', language: 'pt-BR', transcript: true });
});
