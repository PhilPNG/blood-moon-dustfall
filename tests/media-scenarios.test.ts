import test from 'node:test';
import assert from 'node:assert/strict';
import { observeNativePlayback } from '../src/components/media-playback';
import { playbackEventKey, playbackPosition } from '../shared/media-sync';
import type { MediaPlaybackReport, RoomView } from '../shared/types';

class Media extends EventTarget {
  currentTime = 0; readyState = 4; paused = false; ended = false; seeking = false;
}
const identity = { eventKey: 'case:roles:0', clipId: 'opening', kind: 'film' as const };
const view = (patch: Partial<RoomView> = {}): RoomView => ({ code: 'CASE', gameId: 'case', masterReady: true, phase: 'roles', round: 0, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: true, isMaster: false, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0, ...patch });

test('native buffering, backward seek and resume broadcast the actual media position', t => {
  let now = 0; t.mock.method(performance, 'now', () => now);
  const element = new Media(), samples: MediaPlaybackReport[] = [];
  const stop = observeNativePlayback(element as unknown as HTMLMediaElement, identity, sample => samples.push(sample));
  try {
    element.dispatchEvent(new Event('playing'));
    now = 1_000; element.currentTime = 5; element.dispatchEvent(new Event('timeupdate'));
    assert.equal(samples.at(-1)?.position, 5); assert.equal(samples.at(-1)?.playing, true);
    element.readyState = 2; element.dispatchEvent(new Event('waiting'));
    assert.equal(samples.at(-1)?.playing, false);
    now = 2_000; element.currentTime = 6; element.readyState = 4; element.dispatchEvent(new Event('timeupdate'));
    assert.equal(samples.at(-1)?.position, 6); assert.equal(samples.at(-1)?.playing, true);
    element.seeking = true; element.currentTime = 1; element.dispatchEvent(new Event('seeking'));
    assert.equal(samples.at(-1)?.position, 1); assert.equal(samples.at(-1)?.playing, false);
    now = 3_000; element.seeking = false; element.currentTime = 1.2; element.dispatchEvent(new Event('timeupdate'));
    assert.equal(samples.at(-1)?.position, 1.2); assert.equal(samples.at(-1)?.playing, true);
    element.paused = true; element.dispatchEvent(new Event('pause'));
    assert.equal(samples.at(-1)?.playing, false);
  } finally { stop(); }
  const count = samples.length;
  element.paused = false; element.dispatchEvent(new Event('playing'));
  assert.equal(samples.length, count, 'retired media cannot report into the next clip');
});

test('a replay followed by rapid pause and resume never revives the earlier phone caption clock', () => {
  const initial = view();
  const replay = { ...initial, presentation: { eventKey: 'case:roles:0', serial: 1, control: 'replay' as const } };
  const resumed = { ...replay, playbackEpoch: 2 };
  const report = { ...identity, playing: true, position: 3, updatedAt: 100_000, displayId: 'tv' };
  assert.equal(playbackPosition({ ...initial, playback: report }, true, 101_000), 4);
  assert.equal(playbackPosition({ ...replay, playback: report }, true, 101_000), null);
  const replayReport = { ...report, eventKey: 'case:roles:0:presentation:1' };
  assert.equal(playbackPosition({ ...resumed, playback: replayReport }, true, 101_000), null);
  assert.equal(playbackEventKey(resumed, 'case:roles:0'), 'case:roles:0:presentation:1:clock:2');
  const current = { ...report, eventKey: 'case:roles:0:presentation:1:clock:2' };
  assert.equal(playbackPosition({ ...resumed, playback: current }, true, 101_000), 4);
  assert.equal(playbackPosition({ ...resumed, playback: current }, true, 110_000), null);
  assert.equal(playbackPosition({ ...resumed, playback: current }, false, 101_000), null);
});

const { loadMediaManifest } = await import('../src/components/media-manifest');
const { parseCinematicManifest } = await import('../shared/cinematics');
const { parseNarrationManifest } = await import('../shared/narration');
const { readFileSync } = await import('node:fs');
const films = JSON.parse(readFileSync(new URL('../public/media/cinematics.json', import.meta.url), 'utf8'));
const voices = JSON.parse(readFileSync(new URL('../public/media/narration.json', import.meta.url), 'utf8'));

test('a transient film-list outage can be retried without poisoning another loaded media resource', async t => {
  let filmRequests = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    if (String(url).includes('narration')) return Response.json(voices);
    return ++filmRequests === 1 ? new Response('Temporarily unavailable', { status: 503 }) : Response.json(films);
  });
  const narration = await loadMediaManifest('/media/narration.json', parseNarrationManifest);
  await assert.rejects(loadMediaManifest('/media/cinematics.json', parseCinematicManifest), /unavailable/i);
  const recovered = await loadMediaManifest('/media/cinematics.json', parseCinematicManifest);
  assert.equal(recovered.clips.length, 11);
  assert.equal(recovered.clips[0].id, 'opening');
  assert.equal(narration.clips.length, 13, 'a film failure cannot discard an independently loaded narrator');
  assert.ok(narration.clips.find(clip => clip.id === 'roles')?.cues.ptBR.length);
});

test('an empty or malformed successful media response remains a retryable failure', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ version: 1, clips: [] }));
  await assert.rejects(loadMediaManifest('/media/cinematics.json', parseCinematicManifest), /unavailable/i);
  await assert.rejects(loadMediaManifest('/media/narration.json', parseNarrationManifest), /unavailable/i);
});

test('an aborted media load cannot deliver a late response after a reconnect or unmount', async t => {
  const controller = new AbortController();
  let release!: (value: unknown) => void;
  const body = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: () => body }) as Response);
  const pending = loadMediaManifest('/media/cinematics.json', parseCinematicManifest, controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort(); release(films);
  await rejected;
});
