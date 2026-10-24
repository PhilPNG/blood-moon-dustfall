import test from 'node:test';
import assert from 'node:assert/strict';
import { gameStepIdentity } from '../shared/game-step';
import type { RoomView } from '../shared/types';

const voting: Pick<RoomView, 'gameId' | 'phase' | 'round' | 'actionEpoch'> = { gameId: 'first-mystery', phase: 'voting', round: 3, actionEpoch: 1 };

test('a new mystery retires an old accusation even when a sleeping phone misses every intermediate phase', () => {
  assert.notEqual(gameStepIdentity(voting), gameStepIdentity({ ...voting, gameId: 'next-mystery' }));
});

test('a reset lobby has a distinct confirmation scope before any new character deal', () => {
  const initial = { gameId: undefined, phase: 'lobby' as const, round: 0, actionEpoch: 0 };
  assert.notEqual(gameStepIdentity(initial), gameStepIdentity({ ...initial, actionEpoch: 1 }));
});

test('new acts and phases retire previous-step selections and confirmations', () => {
  const act = { ...voting, phase: 'investigation' as const, round: 1 };
  assert.notEqual(gameStepIdentity(act), gameStepIdentity({ ...act, round: 2 }));
  assert.notEqual(gameStepIdentity(act), gameStepIdentity({ ...act, phase: 'voting' }));
});

test('ordinary polls, pause, vote participation and translated content preserve an in-progress confirmation', () => {
  const first = { ...voting, revision: 10, serverNow: 100_000, votesCount: 1, timer: { isPaused: false }, players: [{ name: 'Ada' }] };
  const refreshed = { ...voting, revision: 99, serverNow: 110_000, votesCount: 8, timer: { isPaused: true }, players: [{ name: 'Ada', roleName: 'Personaje' }] };
  assert.equal(gameStepIdentity(first), gameStepIdentity(refreshed));
});

test('legacy views lacking a game identifier or epoch keep a stable identity across fresh copies', () => {
  const legacy = { phase: 'lobby' as const, round: 0 };
  assert.equal(gameStepIdentity(legacy), gameStepIdentity({ ...legacy, gameId: undefined, actionEpoch: 0 }));
});
