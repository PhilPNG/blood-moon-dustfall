import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomView } from '../shared/types';
import { minglingCard, minglingStorageKey } from '../shared/mingling';

function room(overrides: Partial<RoomView> = {}): RoomView {
  return { code: 'MING', gameId: 'game-one', phase: 'investigation', round: 1, settings: { maxPlayers: 20, rounds: 3, roundSeconds: 300 }, players: ['a','b','c','d'].map(id => ({ id, name: id.toUpperCase(), roleName: `Character ${id}`, connected: true, gender: 'any', ready: true })), isLocked: true, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0, isMaster: false, me: { playerId: 'a', ready: true, votedFor: null, clues: [] }, ...overrides };
}
test('private mingle cards rotate through present partners without targeting the same player or changing scores', () => {
  const original = room(), snapshot = structuredClone(original);
  assert.deepEqual([1,2,3].map(round => minglingCard({ ...original, round })?.targetId), ['b','c','d']);
  assert.equal(minglingCard(original)?.targetName, 'B');
  assert.equal(minglingCard(original)?.characterName, 'Character b');
  assert.deepEqual(original, snapshot);
});
test('every seated real player rotates, while away and sample guests are never conversation targets', () => {
  const original = room();
  for (const me of original.players) {
    const targets = [1,2,3].map(round => minglingCard({ ...original, round, me: { ...original.me!, playerId: me.id } })?.targetId);
    assert.equal(new Set(targets).size, 3);
    assert.ok(targets.every(id => id !== me.id));
  }
  const filtered = room({ players: [original.players[0], { ...original.players[1], connected: false }, { ...original.players[2], isDemo: true }, original.players[3]] });
  assert.equal(minglingCard(filtered)?.targetId, 'd');
});
test('spectators, unseated identities, non-investigation phases and a solo table get no private mingle task', () => {
  assert.equal(minglingCard(room({ me: undefined })), null);
  assert.equal(minglingCard(room({ me: { ...room().me!, playerId: 'missing' } })), null);
  assert.equal(minglingCard(room({ players: [room().players[0]] })), null);
  for (const phase of ['lobby','roles','voting','results'] as const) assert.equal(minglingCard(room({ phase })), null);
  for (const round of [0, NaN, Infinity, 1.5]) assert.equal(minglingCard(room({ round })), null);
});
test('mingle output whitelists public identity and neutral prompts even with private case payloads', () => {
  const original = room();
  const card = minglingCard({ ...original, me: { ...original.me!, role: { name: 'PRIVATE_ROLE', gender: 'any', alignment: 'culprit', brief: 'PRIVATE_BRIEF', objective: 'PRIVATE_OBJECTIVE', secret: 'PRIVATE_SECRET' } }, result: { culpritId: 'PRIVATE_CULPRIT', caught: true, tallies: {} } });
  assert.ok(card);
  assert.deepEqual(Object.keys(card).sort(), ['characterName','prompt','targetId','targetName']);
  assert.doesNotMatch(JSON.stringify(card), /PRIVATE_|culprit|secret|objective/);
});
test('local mingle completion cannot bleed between games, acts, seats or replacement partners', () => {
  const original = room();
  const keys = [minglingStorageKey(original, 'b'), minglingStorageKey({ ...original, gameId: 'game-two' }, 'b'), minglingStorageKey({ ...original, round: 2 }, 'b'), minglingStorageKey({ ...original, me: { ...original.me!, playerId: 'c' } }, 'b'), minglingStorageKey(original, 'd')];
  assert.equal(new Set(keys).size, 5);
});
