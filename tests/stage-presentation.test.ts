import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomView } from '../shared/types';
import { evidencePage, preflightCaptionLanguage, preflightEvent, spotlightEvidence } from '../shared/stage-presentation';
import { publicEvidence } from '../shared/evidence-browser';
import { playbackEventKey, playbackMatchesRoom } from '../shared/media-sync';
import { CinematicHistory } from '../shared/cinematics';

const room = (patch: Partial<RoomView> = {}): RoomView => ({ code: 'SHOW', actionEpoch: 2, phase: 'lobby', round: 0, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: false, isMaster: false, timer: { endsAt: null, remaining: 0, isPaused: false }, clues: [], votesCount: 0, ...patch });

test('lobby tests have their own identity across serials and resets without consuming story history', () => {
  const testRoom = room({ preflight: { serial: 1, completed: false } });
  assert.deepEqual(preflightEvent(testRoom), { key: 'legacy-SHOW:lobby:0:preflight:2:1', clipId: 'clue' });
  assert.notEqual(preflightEvent({ ...testRoom, preflight: { serial: 2, completed: false } })?.key, preflightEvent(testRoom)?.key);
  assert.notEqual(preflightEvent({ ...testRoom, actionEpoch: 3 })?.key, preflightEvent(testRoom)?.key);
  const history = new CinematicHistory(); history.claim(preflightEvent(testRoom)!.key);
  assert.equal(history.has('a-new-game:roles:0'), false);
  assert.equal(history.has('a-new-game:investigation:1:clue'), false);
  assert.equal(preflightEvent({ ...testRoom, phase: 'roles' }), null);
  assert.equal(preflightEvent(room()), null);
  assert.equal(preflightCaptionLanguage(testRoom, 'off'), 'en', 'the screen test must show sample captions without changing saved preferences');
  assert.equal(preflightCaptionLanguage(testRoom, 'pt-BR'), 'pt-BR');
  assert.equal(preflightCaptionLanguage(room(), 'off'), 'off');
});

test('only the current scoped native lobby test clock matches, including cleanup after completion', () => {
  const testRoom = room({ preflight: { serial: 3, completed: false }, playbackEpoch: 4 });
  const eventKey = 'legacy-SHOW:lobby:0:preflight:2:3:clock:4';
  const sample = { eventKey, clipId: 'clue', kind: 'film' as const, position: 2, playing: true };
  assert.equal(playbackMatchesRoom(testRoom, sample), true);
  assert.equal(playbackEventKey(testRoom, preflightEvent(testRoom)!.key), eventKey);
  for (const patch of [{ eventKey: 'legacy-SHOW:lobby:0:preflight:2:2:clock:4' }, { eventKey: 'legacy-SHOW:lobby:0:preflight:2:3' }, { clipId: 'opening' }, { kind: 'narration' as const }]) assert.equal(playbackMatchesRoom(testRoom, { ...sample, ...patch }), false);
  assert.equal(playbackMatchesRoom({ ...testRoom, preflight: { serial: 3, completed: true } }, { ...sample, position: 4, playing: false }), true);
  assert.equal(playbackMatchesRoom({ ...testRoom, preflight: undefined }, sample), false);
});

test('spotlight selects only published evidence and waits behind presentations', () => {
  const view = room({ phase: 'investigation', round: 1, act: { title: 'Act', narration: 'Story', prompt: 'Discuss', locations: [], question: { id: 'q', prompt: 'Question', options: [] }, evidence: [{ id: 'auto', title: 'Public automatic evidence', text: 'Public text' }] }, clues: [{ id: 'private', title: 'Secret clue', text: 'Secret text', playerId: 'a', playerName: 'Guest', round: 1, published: false }, { id: 'shared', title: 'Shared clue', text: 'Shared text', playerId: 'a', playerName: 'Guest', round: 1, published: true }], spotlight: { evidenceId: 'case:auto', serial: 1 } });
  assert.equal(spotlightEvidence(view)?.title, 'Public automatic evidence');
  assert.equal(spotlightEvidence(view, true), null);
  assert.equal(spotlightEvidence({ ...view, spotlight: { evidenceId: 'shared:private', serial: 2 } }), null);
  assert.equal(spotlightEvidence({ ...view, spotlight: { evidenceId: 'shared:shared', serial: 2 } })?.text, 'Shared text');
  assert.equal(spotlightEvidence({ ...view, spotlight: undefined }), null);
  const items = publicEvidence(view);
  assert.deepEqual(evidencePage(items, 1, 1).map(item => item.key), ['shared:shared']);
  assert.deepEqual(evidencePage(items, 2, 1).map(item => item.key), ['case:auto']);
});
