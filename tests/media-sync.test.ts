import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameEngine } from '../server/engine.js';
import { OnlineGameService } from '../online/service.js';
import { MemoryRoomRepository } from '../online/repository.js';
import { cinematicEvent, parseCinematicManifest } from '../shared/cinematics.js';
import { parseNarrationManifest } from '../shared/narration.js';
import { playbackEventKey, playbackPosition } from '../shared/media-sync.js';
import type { DisplayCapability, RoomView, Session } from '../shared/types.js';

function party() {
  let now = 90_000;
  const engine = new GameEngine({ now: () => now });
  const master = engine.create();
  const players = Array.from({ length: 4 }, (_, i) => engine.join({ code: master.code, name: `Guest ${i}`, gender: 'any' }));
  engine.command(master.code, master.token, { type: 'start' });
  now = 100_000; // The phase's audience cue has completed.
  const cap = engine.claimDisplay(master.code, 'tv-one');
  const sample = () => ({ eventKey: cinematicEvent(engine.view(master.code))!.key, clipId: 'opening', kind: 'film', position: 2, playing: true });
  return { engine, master, players, cap, sample, setNow(value: number) { now = value; } };
}

test('a scoped display capability grants no private identity and only one live TV lease', () => {
  const { engine, master, cap, sample, setNow } = party();
  assert.ok(cap.active && cap.token);
  assert.notEqual(cap.token, master.token);
  assert.throws(() => engine.command(master.code, cap.token, { type: 'pause' }), /token/i);
  assert.throws(() => engine.reportPlayback(master.code, 'tv-one', master.token, sample(), 1), /display/i);
  assert.equal(engine.claimDisplay(master.code, 'tv-two').active, false);
  engine.reportPlayback(master.code, 'tv-one', cap.token, sample(), 1);
  const view = engine.view(master.code);
  assert.equal(view.playback?.updatedAt, 100_000);
  assert.equal(view.playback?.position, 2);
  assert.equal(JSON.stringify(view).includes(cap.token!), false);
  setNow(109_000);
  const replacement = engine.claimDisplay(master.code, 'tv-two');
  assert.ok(replacement.active && replacement.token !== cap.token);
  assert.throws(() => engine.reportPlayback(master.code, 'tv-one', cap.token, sample(), 2), /display/i);
});

test('playback rejects stale ordering, other phases, unknown clips and excessive positions atomically', () => {
  const { engine, master, cap, sample } = party();
  engine.reportPlayback(master.code, 'tv-one', cap.token, sample(), 2);
  const before = engine.exportRoom(master.code);
  for (const [payload, sequence] of [[sample(), 1], [{ ...sample(), clipId: 'fake' }, 3], [{ ...sample(), position: 200 }, 3], [{ ...sample(), eventKey: 'stale:roles:0' }, 3]] as const) {
    assert.throws(() => engine.reportPlayback(master.code, 'tv-one', cap.token, payload, sequence), /playback|sequence|clip|phase/i);
    assert.deepEqual(engine.exportRoom(master.code), before);
  }
  engine.command(master.code, master.token, { type: 'advance' });
  assert.equal(engine.view(master.code).playback, undefined);
  assert.throws(() => engine.reportPlayback(master.code, 'tv-one', cap.token, { ...sample(), clipId: 'opening' }, 3), /playback|clip|phase/i);
});

test('phone clocks follow server time and stop for pause, offline, stale or retired media', () => {
  const { engine, master, cap, sample } = party();
  engine.reportPlayback(master.code, 'tv-one', cap.token, sample(), 1);
  const view = engine.view(master.code);
  assert.equal(playbackPosition(view, true, 102_000), 4);
  assert.equal(playbackPosition(view, false, 102_000), null);
  assert.equal(playbackPosition(view, true, 111_000), null);
  assert.equal(playbackPosition({ ...view, timer: { ...view.timer, isPaused: true } }, true, 102_000), null);
  assert.equal(playbackPosition({ ...view, phase: 'investigation', round: 1 }, true, 102_000), null);
  assert.equal(playbackPosition({ ...view, playback: { ...view.playback!, playing: false } }, true, 102_000), null);
});

test('a GM skip or replay invalidates in-flight reports from the previous media take', () => {
  const { engine, master, cap, sample } = party();
  const old = sample();
  engine.reportPlayback(master.code, 'tv-one', cap.token, old, 1);
  engine.command(master.code, master.token, { type: 'presentation', control: 'skip' });
  assert.throws(() => engine.reportPlayback(master.code, 'tv-one', cap.token, old, 2), /playback|phase/i);
});

test('quick pause and resume cannot extrapolate the TV clock through the paused interval', () => {
  const { engine, master, cap, sample, setNow } = party();
  engine.reportPlayback(master.code, 'tv-one', cap.token, sample(), 1);
  const initialFilm = cinematicEvent(engine.view(master.code));
  setNow(101_000);
  engine.command(master.code, master.token, { type: 'pause' });
  assert.equal(engine.view(master.code).playback, undefined);
  setNow(105_000);
  engine.command(master.code, master.token, { type: 'resume' });
  const resumed = engine.view(master.code);
  assert.equal(playbackPosition(resumed, true, 105_000), null);
  assert.deepEqual(cinematicEvent(resumed), initialFilm, 'pause must preserve the mounted film/history identity');
  assert.equal(resumed.presentation, undefined, 'resume must not request a film replay');
  const current = { ...sample(), eventKey: playbackEventKey(resumed, initialFilm!.key), position: 3 };
  engine.reportPlayback(master.code, 'tv-one', cap.token, current, 2);
  assert.equal(playbackPosition(engine.view(master.code), true, 105_000), 3);
});

test('a higher-sequence report captured before pause cannot revive captions after resume', () => {
  const { engine, master, cap, sample, setNow } = party();
  const delayed = sample();
  engine.reportPlayback(master.code, 'tv-one', cap.token, delayed, 1);
  setNow(101_000);
  engine.command(master.code, master.token, { type: 'pause' });
  const paused = engine.view(master.code);
  const pausedReport = { ...delayed, eventKey: playbackEventKey(paused, delayed.eventKey), playing: false, position: 3 };
  setNow(105_000);
  engine.command(master.code, master.token, { type: 'resume' });
  const before = engine.exportRoom(master.code);
  for (const report of [delayed, pausedReport]) {
    assert.throws(() => engine.reportPlayback(master.code, 'tv-one', cap.token, report, 10), /playback|phase/i);
    assert.deepEqual(engine.exportRoom(master.code), before);
  }
  assert.equal(playbackPosition(engine.view(master.code), true, 105_000), null);
});

test('online display claims and clocks persist without receipts exposing capabilities', async () => {
  const repository = new MemoryRoomRepository();
  let service = new OnlineGameService({ repository, now: () => 90_000 });
  const master = await service.execute('room:create', {}) as Session;
  for (let i = 0; i < 4; i++) await service.execute('room:join', { code: master.code, name: `Guest ${i}`, gender: 'any' });
  await service.execute('room:command', { ...master, action: { type: 'start' } });
  service = new OnlineGameService({ repository, now: () => 100_000 });
  const cap = await service.execute('room:display-claim', { code: master.code, displayId: 'tv-one' }) as DisplayCapability;
  const view = await service.execute('room:subscribe', { code: master.code }) as RoomView;
  await service.execute('room:playback', { code: master.code, displayId: 'tv-one', token: cap.token, sequence: 1, playback: { eventKey: cinematicEvent(view)!.key, clipId: 'opening', kind: 'film', position: 3, playing: true } });
  const publicView = await service.execute('room:subscribe', { code: master.code }) as RoomView;
  assert.equal(publicView.playback?.position, 3);
  assert.equal(JSON.stringify(publicView).includes(cap.token!), false);
});

test('every produced film and narration has aligned Spanish cues and a matching VTT', () => {
  for (const [file, parse, folder] of [['cinematics', parseCinematicManifest, 'captions'], ['narration', parseNarrationManifest, 'narrator']] as const) {
    const raw = JSON.parse(readFileSync(new URL(`../public/media/${file}.json`, import.meta.url), 'utf8'));
    const manifest = parse(raw);
    assert.equal(manifest.clips.length, raw.clips.length);
    for (const clip of manifest.clips) {
      assert.equal(clip.cues.es?.length, clip.cues.en.length, `${file}/${clip.id}`);
      assert.deepEqual(clip.cues.es?.map(({ start, end }) => [start, end]), clip.cues.en.map(({ start, end }) => [start, end]));
      const vtt = readFileSync(new URL(`../public/media/${folder}/${clip.id}.es.vtt`, import.meta.url), 'utf8');
      for (const cue of clip.cues.es || []) assert.ok(vtt.includes(cue.text));
    }
  }
});

test('live voting exposes participation without candidate totals or private choices', () => {
  const { engine, master, players } = party();
  for (let i = 0; i < 4; i++) engine.command(master.code, master.token, { type: 'advance' });
  engine.command(master.code, players[0].token, { type: 'vote', playerId: players[1].playerId });
  const view = engine.view(master.code);
  assert.equal(view.votesCount, 1);
  assert.equal(view.players[0].hasVoted, true);
  assert.equal(view.players[1].hasVoted, false);
  assert.equal(view.result, undefined);
  assert.equal(JSON.stringify(view).includes('votedFor'), false);
});
