import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Display } from '../src/components/Display.js';
import type { PairingTicket, RoomView } from '../shared/types.js';

function room(masterReady: boolean): RoomView {
  return { code: 'CASE', masterReady, phase: 'lobby', round: 0, settings: { rounds: 3, roundSeconds: 180, maxPlayers: 12 }, players: [], isLocked: false, timer: { endsAt: null, remaining: 180, isPaused: false }, clues: [], votesCount: 0, isMaster: false };
}
const pairing: PairingTicket = { code: 'CASE', ticket: 'one-use-pairing-ticket', expiresAt: Date.now() + 600_000 };
function render(masterReady: boolean, ticket?: PairingTicket) {
  return renderToStaticMarkup(createElement(Display, { room: room(masterReady), connected: true, joinOrigin: 'https://alibi.example', pairing: ticket }));
}
test('an unclaimed room shows a private phone pairing link without a player invitation', () => {
  const html = render(false, pairing);
  assert.match(html, /Game master QR/);
  assert.match(html, /private phone controls/);
  assert.match(html, /https:\/\/alibi\.example\/host\/CASE#ticket=one-use-pairing-ticket/);
  assert.doesNotMatch(html, /\/join\/CASE|SCAN TO JOIN/);
});
test('a public display without the local ticket waits without granting control', () => {
  const html = render(false);
  assert.match(html, /Waiting for the game master/);
  assert.doesNotMatch(html, /\/host\/CASE|\/join\/CASE|one-use-pairing-ticket/);
});
test('a claimed room shows the player invitation and suppresses an old pairing ticket', () => {
  const html = render(true, pairing);
  assert.match(html, /\/join\/CASE|SCAN TO JOIN/);
  assert.doesNotMatch(html, /one-use-pairing-ticket|Game master QR/);
});
