import test from 'node:test';
import assert from 'node:assert/strict';
import { routeAnchor } from '../src/route-anchor';
import { roomCommandPayload } from '../src/room-command';
import type { RoomView } from '../shared/types';

const room: RoomView = { code: 'CASE', gameId: 'first-deal', phase: 'investigation', round: 2, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: true, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0, isMaster: true };

test('copied anchors decode ordinary Unicode without crashing on broken percent escapes', () => {
  assert.equal(routeAnchor('#saloon%20%26%20stars'), 'saloon & stars');
  assert.equal(routeAnchor('#evid%C3%AAncias'), 'evidências');
  for (const hash of ['#%', '#%E0%A4%A', '#%FF', '#literal%name']) assert.equal(routeAnchor(hash), hash.slice(1));
  assert.equal(routeAnchor(''), '');
});

test('GM and phone commands carry the exact observed deal, phase and act before async delivery', () => {
  for (const action of [{ type: 'advance' }, { type: 'answer', optionId: 'coil' }, { type: 'ready', ready: true }, { type: 'vote', playerId: 'guest' }] as const) {
    const view = structuredClone(room);
    const payload = roomCommandPayload(view, { code: 'CASE', token: 'private' }, action, 'pt-BR');
    view.gameId = 'next-deal'; view.phase = 'voting'; view.round = 3;
    assert.deepEqual(payload, { code: 'CASE', token: 'private', action, language: 'pt-BR', context: { gameId: 'first-deal', phase: 'investigation', round: 2, actionEpoch: 0 } });
  }
  const lobby = { ...room, gameId: undefined, phase: 'lobby' as const, round: 0 };
  assert.deepEqual(roomCommandPayload(lobby, { code: 'CASE', token: 'gm' }, { type: 'start' }, 'en').context, { gameId: null, phase: 'lobby', round: 0, actionEpoch: 0 });
});


test('reset lobby actions include a new action epoch even before another character deal', () => {
  const lobby = { ...room, gameId: undefined, phase: 'lobby' as const, round: 0, actionEpoch: 4 };
  assert.deepEqual(roomCommandPayload(lobby, { code: 'CASE', token: 'gm' }, { type: 'start' }, 'en').context, { gameId: null, phase: 'lobby', round: 0, actionEpoch: 4 });
});
