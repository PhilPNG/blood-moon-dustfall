import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomView } from '../shared/types.js';
import { narrationCue, narrationEvent, narrationPlayback, parseNarrationManifest } from '../shared/narration.js';

const room = (patch: Partial<RoomView> = {}): RoomView => ({ code: 'DUST', gameId: 'first-game', phase: 'lobby', round: 0, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: false, isMaster: false, clues: [], votesCount: 0, timer: { endsAt: null, remaining: 300, isPaused: false }, ...patch });
const options = { sound: true, blocked: false, phaseConsumed: false, timerConsumed: false, evidenceConsumed: false, evidenceReady: false, remaining: 100 };
test('host narration follows the current public phase and compressed story acts', () => {
  assert.equal(narrationEvent(room()).clipId, 'lobby');
  assert.equal(narrationEvent(room({ phase: 'roles' })).clipId, 'roles');
  assert.equal(narrationEvent(room({ phase: 'investigation', round: 2, settings: { rounds: 2, roundSeconds: 300, maxPlayers: 20 } })).clipId, 'act-3');
  assert.equal(narrationEvent(room({ phase: 'investigation', round: 4, settings: { rounds: 5, roundSeconds: 300, maxPlayers: 20 } })).clipId, 'act-4');
  assert.equal(narrationEvent(room({ phase: 'voting' })).clipId, 'voting');
  assert.equal(narrationEvent(room({ phase: 'results', result: { culpritId: 'a', caught: true, tallies: { a: 3 } } })).clipId, 'caught');
  assert.equal(narrationEvent(room({ phase: 'results', result: { culpritId: 'a', caught: false, tallies: { b: 3 } } })).clipId, 'escaped-wrong');
  assert.equal(narrationEvent(room({ phase: 'results', result: { culpritId: 'a', caught: false, tallies: {} } })).clipId, 'escaped-tie');
});
test('the host never speaks over a film, before sound permission, or while paused', () => {
  for (const patch of [{ sound: false }, { blocked: true }]) assert.equal(narrationCue(room(), { ...options, ...patch }), null);
  assert.equal(narrationCue(room({ timer: { endsAt: null, remaining: 50, isPaused: true } }), options), null);
  assert.equal(narrationCue(room({ masterReady: false }), options), null);
  assert.equal(narrationCue(room(), { ...options, phaseConsumed: true }), null);
});
test('warning and evidence cues occur once in the current act after its film', () => {
  const view = room({ phase: 'investigation', round: 1 });
  assert.equal(narrationCue(view, { ...options, phaseConsumed: true, remaining: 30 })?.clipId, 'timer-warning');
  assert.equal(narrationCue(view, { ...options, phaseConsumed: true, remaining: 30, timerConsumed: true }), null);
  assert.equal(narrationCue(view, { ...options, phaseConsumed: true, evidenceReady: true })?.clipId, 'evidence');
  assert.equal(narrationCue(view, { ...options, phaseConsumed: true, evidenceReady: true, evidenceConsumed: true }), null);
  assert.equal(narrationCue({ ...view, phase: 'voting' }, { ...options, phaseConsumed: true, evidenceReady: true, remaining: 30 }), null);
  assert.notEqual(narrationEvent(view).key, narrationEvent({ ...view, gameId: 'new-game' }).key);
});
test('narration manifest accepts local audio and accurate time cues without accepting executable sources', () => {
  const clip = { id: 'roles', title: 'Meet your character', src: '/media/narrator/roles.mp3', duration: 12, cues: { en: [{ start: 0, end: 2, text: 'Welcome.' }], ptBR: [{ start: 0, end: 2, text: 'Boas-vindas.' }] } };
  assert.equal(parseNarrationManifest({ version: 1, clips: [clip] }).clips[0].src, clip.src);
  assert.equal(parseNarrationManifest({ version: 1, clips: [{ ...clip, src: 'javascript:bad' }, { ...clip, id: 'not-a-cue' }] }).clips.length, 0);
  assert.equal(parseNarrationManifest(null).clips.length, 0);
});


test('pausing, disconnecting, muting, or playing a film suspends the same host request and preserves its position', () => {
  const request = { key: 'first-game:investigation:1:narration:act-1', phaseKey: 'first-game:investigation:1', clipId: 'act-1', currentTime: 12.75 };
  const available = { connected: true, sound: true, paused: false, cinematicBlocked: false };
  for (const interruption of [{ paused: true }, { connected: false }, { sound: false }, { cinematicBlocked: true }]) {
    const stopped = narrationPlayback(request, request.phaseKey, { ...available, ...interruption });
    assert.equal(stopped.active, request);
    assert.equal(stopped.active?.currentTime, 12.75);
    assert.equal(stopped.suspended, true);
    const resumed = narrationPlayback(stopped.active, request.phaseKey, available);
    assert.equal(resumed.active, request);
    assert.equal(resumed.active?.currentTime, 12.75);
    assert.equal(resumed.suspended, false);
  }
  assert.equal(narrationPlayback(request, 'first-game:investigation:2', available).active, null);
  assert.equal(narrationPlayback(null, request.phaseKey, available).active, null);
});
