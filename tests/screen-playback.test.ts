import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MEDIA_DURATIONS, playbackEventKey, PLAYBACK_STALE_MS } from '../shared/media-sync.js';
import { MEDIA_TITLES, screenPlayback } from '../shared/screen-playback.js';
import type { RoomView } from '../shared/types.js';

const sampleTime = 100_000;

function mediaRoom(kind: 'film' | 'narration' = 'film', clipId = 'opening'): RoomView {
  const phase = clipId === 'lobby' ? 'lobby' : ['opening', 'roles'].includes(clipId) ? 'roles'
    : clipId === 'voting' ? 'voting' : ['caught', 'escaped-wrong', 'escaped-tie'].includes(clipId) ? 'results' : 'investigation';
  const round = clipId.startsWith('act-') ? Number(clipId.slice(4)) : phase === 'investigation' ? 1 : phase === 'lobby' || phase === 'roles' ? 0 : 5;
  const room: RoomView = {
    code: 'DUST', gameId: 'game-one', serverNow: sampleTime, masterReady: true,
    phase, round, settings: { rounds: 5, roundSeconds: 300, maxPlayers: 12 },
    players: [], isLocked: false, timer: { endsAt: null, remaining: 300, isPaused: false },
    clues: [], votesCount: 0, isMaster: true,
    ...(phase === 'results' ? { result: { culpritId: 'culprit', tallies: clipId === 'escaped-tie' ? { one: 2, two: 2 } : { one: 4 }, caught: clipId === 'caught' } } : {}),
  };
  const phaseKey = `game-one:${phase}:${round}`;
  room.playback = {
    kind, clipId, eventKey: kind === 'film' ? phaseKey : `${phaseKey}:narration:${clipId}`,
    position: 2, playing: true, updatedAt: sampleTime, displayId: 'public-tv',
  };
  return room;
}

test('fresh film playback reports produce a silent public projection with server-time progress', () => {
  assert.deepEqual(screenPlayback(mediaRoom(), true, 101_500), {
    status: 'playing', kind: 'film', clipId: 'opening', title: 'Blood Moon over Dustfall',
    position: 3.5, duration: 18.042, progress: 3.5 / 18.042 * 100,
  });
});

test('fresh narration reports use narration metadata and the current narration event', () => {
  const view = screenPlayback(mediaRoom('narration', 'roles'), true, 101_000);
  assert.deepEqual(view, {
    status: 'playing', kind: 'narration', clipId: 'roles', title: 'Your secret identity',
    position: 3, duration: 19.879, progress: 3 / 19.879 * 100,
  });
});

test('offline and game-paused states take precedence and clear every media detail', () => {
  const room = mediaRoom();
  const paused = { ...room, timer: { ...room.timer, isPaused: true } };
  assert.deepEqual(screenPlayback(room, false, 101_000), { status: 'offline' });
  assert.deepEqual(screenPlayback(paused, false, 101_000), { status: 'offline' });
  assert.deepEqual(screenPlayback(paused, true, 101_000), { status: 'paused' });
  assert.deepEqual(screenPlayback({ ...paused, playback: undefined, serverNow: undefined }, true, NaN), { status: 'paused' });
});

test('a stopped native sample remains on hold at its reported position', () => {
  const room = mediaRoom();
  room.playback!.playing = false;
  for (const now of [100_000, 102_500, 109_999]) {
    assert.deepEqual(screenPlayback(room, true, now), {
      status: 'holding', kind: 'film', clipId: 'opening', title: 'Blood Moon over Dustfall',
      position: 2, duration: 18.042, progress: 2 / 18.042 * 100,
    });
  }
});

test('completion requires a fresh stopped native sample within 150ms of the authored end', () => {
  const room = mediaRoom();
  for (const position of [18.042 - .15, 18, 18.042, 19]) {
    room.playback = { ...room.playback!, position, playing: false };
    const result = screenPlayback(room, true, 109_000);
    assert.equal(result.status, 'complete', String(position));
    if ('position' in result) assert.equal(result.position, Math.min(position, 18.042));
  }
  room.playback = { ...room.playback!, position: 18.042 - .151 };
  assert.equal(screenPlayback(room, true, 109_000).status, 'holding');
});

test('elapsed time alone never turns a playing report into completion', () => {
  const room = mediaRoom('film', 'clue');
  const result = screenPlayback(room, true, 109_000);
  assert.deepEqual(result, {
    status: 'playing', kind: 'film', clipId: 'clue', title: 'A New Lead',
    position: 4.042, duration: 4.042, progress: 100,
  });
  assert.deepEqual(screenPlayback({ ...room, playback: undefined }, true, 109_000), { status: 'standby' });
});

test('reports become standby exactly at the shared ten-second freshness boundary', () => {
  for (const playing of [true, false]) {
    const room = mediaRoom();
    room.playback!.playing = playing;
    assert.equal(screenPlayback(room, true, sampleTime + PLAYBACK_STALE_MS - 1).status, playing ? 'playing' : 'holding');
    assert.deepEqual(screenPlayback(room, true, sampleTime + PLAYBACK_STALE_MS), { status: 'standby' });
    assert.deepEqual(screenPlayback(room, true, sampleTime + PLAYBACK_STALE_MS + 1), { status: 'standby' });
  }
});

test('phase changes and replay commands retire previous media samples', () => {
  for (const kind of ['film', 'narration'] as const) {
    const room = mediaRoom(kind, kind === 'film' ? 'opening' : 'roles');
    assert.deepEqual(screenPlayback({ ...room, phase: 'investigation', round: 1 }, true, sampleTime), { status: 'standby' });
    const replayed: RoomView = { ...room, presentation: { eventKey: 'game-one:roles:0', serial: 2, control: 'replay' } };
    assert.deepEqual(screenPlayback(replayed, true, sampleTime), { status: 'standby' });
    replayed.playback = { ...room.playback!, eventKey: playbackEventKey(replayed, room.playback!.eventKey) };
    assert.equal(screenPlayback(replayed, true, sampleTime).status, 'playing');
    assert.deepEqual(screenPlayback({ ...replayed, gameId: 'game-two' }, true, sampleTime), { status: 'standby' });
  }
});

test('pause epochs retire both old running and old stopped reports after resume', () => {
  for (const playing of [true, false]) {
    const room = mediaRoom();
    room.playback!.playing = playing;
    const resumed = { ...room, playbackEpoch: 2 };
    assert.deepEqual(screenPlayback(resumed, true, sampleTime), { status: 'standby' });
    resumed.playback = { ...room.playback!, eventKey: playbackEventKey(resumed, room.playback!.eventKey) };
    assert.equal(screenPlayback(resumed, true, sampleTime).status, playing ? 'playing' : 'holding');
  }
});

test('unknown clips, mismatched clip events and media kinds cannot revive the monitor', () => {
  const room = mediaRoom();
  for (const report of [
    { ...room.playback!, clipId: 'not-authored' },
    { ...room.playback!, clipId: '__proto__' },
    { ...room.playback!, clipId: 'constructor' },
    { ...room.playback!, clipId: 'act-1' },
    { ...room.playback!, eventKey: 'another-event' },
    { ...room.playback!, kind: 'audio' },
  ]) {
    assert.deepEqual(screenPlayback({ ...room, playback: report as RoomView['playback'] }, true, sampleTime), { status: 'standby' });
  }
  assert.deepEqual(screenPlayback({ ...room, masterReady: false }, true, sampleTime), { status: 'standby' });
});

test('missing and non-finite time or position values cannot produce active progress', () => {
  const room = mediaRoom();
  assert.deepEqual(screenPlayback({ ...room, playback: undefined }, true, sampleTime), { status: 'standby' });
  for (const invalid of [undefined, null, NaN, Infinity, -Infinity, '100000']) {
    assert.deepEqual(screenPlayback({ ...room, serverNow: invalid as number }, true, sampleTime), { status: 'standby' });
    assert.deepEqual(screenPlayback(room, true, invalid as number), { status: 'standby' });
    for (const field of ['updatedAt', 'position'] as const) {
      assert.deepEqual(screenPlayback({ ...room, playback: { ...room.playback!, [field]: invalid } as RoomView['playback'] }, true, sampleTime), { status: 'standby' });
    }
  }
  for (const playing of [undefined, null, 0, 1, 'true']) {
    assert.deepEqual(screenPlayback({ ...room, playback: { ...room.playback!, playing } as unknown as RoomView['playback'] }, true, sampleTime), { status: 'standby' });
  }
});

test('progress clamps to authored bounds and backwards time cannot add playback', () => {
  const room = mediaRoom();
  for (const [position, now, expected] of [[-20, sampleTime, 0], [20, sampleTime, 18.042], [2, sampleTime - 5_000, 2], [0, sampleTime, 0]]) {
    room.playback!.position = position;
    const result = screenPlayback(room, true, now);
    assert.equal(result.status, 'playing');
    assert.ok('position' in result);
    assert.equal(result.position, expected);
    assert.ok(result.progress >= 0 && result.progress <= 100);
    assert.equal(result.progress, expected / 18.042 * 100);
  }
  assert.equal(screenPlayback({ ...room, serverNow: 0, playback: { ...room.playback!, updatedAt: 0 } }, true, 0).status, 'playing', 'zero is a valid server timestamp');
});

test('all 24 authored public clips have exact title and duration metadata and a valid projection', () => {
  let count = 0;
  for (const [kind, file] of [['film', 'cinematics'], ['narration', 'narration']] as const) {
    const manifest = JSON.parse(readFileSync(new URL(`../public/media/${file}.json`, import.meta.url), 'utf8')) as { clips: { id: string; title: string; duration: number }[] };
    assert.deepEqual(Object.keys(MEDIA_TITLES[kind]).sort(), manifest.clips.map(clip => clip.id).sort());
    assert.deepEqual(Object.keys(MEDIA_DURATIONS[kind]).sort(), manifest.clips.map(clip => clip.id).sort());
    for (const clip of manifest.clips) {
      count++;
      assert.equal((MEDIA_TITLES[kind] as Record<string, string>)[clip.id], clip.title);
      assert.equal((MEDIA_DURATIONS[kind] as Record<string, number>)[clip.id], clip.duration);
      const room = mediaRoom(kind, clip.id);
      const result = screenPlayback(room, true, sampleTime);
      assert.equal(result.status, 'playing', `${kind}/${clip.id}`);
      assert.ok('title' in result);
      assert.equal(result.title, clip.title);
      assert.equal(result.duration, clip.duration);
    }
  }
  assert.equal(count, 24);
});

test('the projection exposes no display, event, media payload or private room fields', () => {
  const room = mediaRoom();
  const report = { ...room.playback!, token: 'private-display-token', src: 'https://private.invalid/media.mp4', cues: [{ text: 'private transcript' }] };
  const privateRoom = { ...room, playback: report, masterToken: 'master-secret', culpritId: 'private-culprit', solution: 'private-solution' };
  const before = JSON.stringify(privateRoom);
  const result = screenPlayback(privateRoom, true, sampleTime);
  assert.deepEqual(Object.keys(result).sort(), ['status', 'kind', 'clipId', 'title', 'position', 'duration', 'progress'].sort());
  assert.equal(JSON.stringify(privateRoom), before, 'projection must not mutate the room or report');
  const serialized = JSON.stringify(result);
  for (const privateValue of ['public-tv', 'game-one', 'private-display-token', 'private.invalid', 'private transcript', 'master-secret', 'private-culprit', 'private-solution']) assert.equal(serialized.includes(privateValue), false);
});
