import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Clock } from '../src/components/Clock';
import { Master } from '../src/components/Master';
import { Display } from '../src/components/Display';
import { Player } from '../src/components/Player';
import type { RoomView } from '../shared/types';

function investigation(): RoomView {
  return {
    code: 'TIME', phase: 'investigation', round: 1, serverNow: 1_000_000,
    settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 },
    players: [{ id: 'p', name: 'Guest', gender: 'any', ready: true, connected: true }],
    isLocked: true, timer: { endsAt: 1_300_000, remaining: 300, isPaused: false },
    clues: [], votesCount: 0, isMaster: true,
    me: { playerId: 'p', clues: [], ready: true, votedFor: null },
  };
}

test('the shared Clock uses server time even when the browser clock is hours ahead or behind', t => {
  const room = investigation();
  let wallTime = 0;
  t.mock.method(Date, 'now', () => wallTime);
  for (const skew of [-21_600_000, 21_600_000]) {
    wallTime = room.serverNow! + skew;
    const html = renderToStaticMarkup(createElement(Clock, { timer: room.timer, serverNow: room.serverNow }));
    assert.ok(html.includes('>05:00</'), `Clock must use the server deadline with ${skew}ms local skew`);
    assert.doesNotMatch(html, /clock-low/);
  }
});

test('the GM, public TV and player phone all render the same server-authoritative countdown', t => {
  const room = investigation();
  t.mock.method(Date, 'now', () => room.serverNow! + 21_600_000);
  const views = [
    createElement(Master, { room, connected: true, command: async () => {}, joinOrigin: 'https://alibi.example', onHome: () => {} }),
    createElement(Display, { room: { ...room, isMaster: false, me: undefined }, connected: true, joinOrigin: 'https://alibi.example' }),
    createElement(Player, { room: { ...room, isMaster: false }, connected: true, command: async () => {}, onLeave: () => {} }),
  ];
  for (const view of views) {
    const html = renderToStaticMarkup(view);
    assert.ok(html.includes('>05:00</'), 'Every device must render the same five-minute countdown');
    assert.doesNotMatch(html, />00:00<\//);
  }
});

test('paused and legacy countdown views stay readable without a server timestamp', () => {
  for (const timer of [
    { endsAt: null, remaining: 333, isPaused: true },
    { endsAt: 1_300_000, remaining: 333, isPaused: false },
  ]) {
    const html = renderToStaticMarkup(createElement(Clock, { timer }));
    assert.match(html, />05:33<\//);
  }
});
