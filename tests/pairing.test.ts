import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { Display } from '../src/components/Display.js';
import type { PairingTicket, RoomView } from '../shared/types.js';

function room(masterReady: boolean): RoomView {
  return { code: 'CASE', masterReady, phase: 'lobby', round: 0, settings: { rounds: 3, roundSeconds: 180, maxPlayers: 12 }, players: [], isLocked: false, timer: { endsAt: null, remaining: 180, isPaused: false }, clues: [], votesCount: 0, isMaster: false };
}
const pairing: PairingTicket = { code: 'CASE', ticket: 'one-use-pairing-ticket', expiresAt: Date.now() + 600_000 };
function render(masterReady: boolean, ticket?: PairingTicket, joinOrigin = 'https://alibi.example') {
  return renderToStaticMarkup(createElement(Display, { room: room(masterReady), connected: true, joinOrigin, pairing: ticket }));
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

test('the private pairing QR encodes the custom-domain phone address', () => {
  const html = render(false, pairing, 'https://party.devicebytes.com/');
  const expectedQR = renderToStaticMarkup(createElement(QRCodeSVG, {
    value: 'https://party.devicebytes.com/host/CASE#ticket=one-use-pairing-ticket',
    size: 260, level: 'M', marginSize: 2, title: 'Game master pairing for Dustfall room CASE',
  }));
  assert.ok(html.includes(expectedQR), 'The pairing QR must encode the custom-domain private phone link.');
  assert.match(html, /https:\/\/party\.devicebytes\.com\/host\/CASE#ticket=one-use-pairing-ticket/);
  assert.doesNotMatch(html, /\/join\/CASE|blood-moon-dustfall\.vercel\.app/);
});

test('after pairing the public QR encodes only the custom-domain player invitation', () => {
  const html = render(true, pairing, 'https://party.devicebytes.com/');
  const expectedQR = renderToStaticMarkup(createElement(QRCodeSVG, {
    value: 'https://party.devicebytes.com/join/CASE',
    size: 185, level: 'M', marginSize: 2, title: 'Join Dustfall room CASE',
  }));
  assert.ok(html.includes(expectedQR), 'The public QR must encode the custom-domain player invitation.');
  assert.match(html, /href="https:\/\/party\.devicebytes\.com\/join\/CASE"/);
  assert.doesNotMatch(html, /one-use-pairing-ticket|#ticket=|\/host\/CASE|blood-moon-dustfall\.vercel\.app/);
});
