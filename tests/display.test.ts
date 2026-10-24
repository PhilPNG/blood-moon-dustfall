import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Display } from '../src/components/Display.js';
import type { RoomView } from '../shared/types.js';

function room(): RoomView {
  return {
    code: 'DUST', masterReady: true, phase: 'investigation', round: 2,
    settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 },
    players: [
      { id: 'a', name: 'Alex', gender: 'man', connected: true, ready: true, characterId: 'silas-vale', roleName: 'Marshal Silas Vale' },
      { id: 'b', name: 'Beverly With A Very Long Name', gender: 'woman', connected: false, ready: false, characterId: 'seraphina-bell', roleName: 'Seraphina Bell' },
    ],
    isLocked: true, timer: { endsAt: null, remaining: 284, isPaused: false }, clues: [], votesCount: 1, isMaster: false,
    act: { title: 'Act II · The Black Star Bargain', narration: 'An unsigned treaty stands between someone and a fortune.', prompt: 'What proves a plan to profit?', evidence: [{ id: 'core', title: 'The Auction Offer', text: 'A living core is offered under the alias Black Star.' }], locations: [], question: { id: 'question-2', prompt: 'What stopped the private sale?', options: [{ id: 'treaty', text: 'Joint custody in the treaty' }, { id: 'weather', text: 'The desert weather' }] } },
    suspicions: { a: 2, b: 0 }, searchCount: 2, answerCount: 1,
  };
}
const render = (view: RoomView) => renderToStaticMarkup(createElement(Display, { room: view, connected: true, joinOrigin: 'https://dustfall.example' }));

test('investigation shows the public case question, automatic evidence and live phone activity', () => {
  const html = render(room());
  for (const copy of ['The Black Star Bargain', 'The Auction Offer', 'A living core is offered', 'What proves a plan to profit?', 'What stopped the private sale?', 'Joint custody in the treaty', 'searched', 'answered', 'Anonymous suspicion']) assert.ok(html.includes(copy), copy);
  assert.match(html, /\/assets\/characters\/silas-vale.webp/);
});

test('the shared evidence rail retains all published clues and filters private stale state', () => {
  const view = room();
  view.clues = Array.from({ length: 6 }, (_, i) => ({ id: `clue-${i}`, title: `Shared clue ${i}`, text: `Public statement ${i}`, round: i < 3 ? 1 : 2, playerId: 'a', playerName: 'Alex', published: true }));
  view.clues.push({ id: 'private', title: 'Unshared secret', text: 'Hidden confession', round: 2, playerId: 'a', playerName: 'Alex', published: false });
  view.me = { playerId: 'a', clues: [], votedFor: null, ready: true, role: { name: 'Role', gender: 'man', alignment: 'culprit', brief: 'Hidden brief', objective: 'Hidden objective' } };
  const html = render(view);
  for (let i = 0; i < 6; i++) assert.ok(html.includes(`Shared clue ${i}`));
  assert.doesNotMatch(html, /Unshared secret|Hidden confession|Hidden brief|Hidden objective/);
});

test('final accusations show only sealed progress even if stale result data is supplied', () => {
  const view = room(); view.phase = 'voting';
  view.result = { culpritId: 'a', caught: true, tallies: { a: 19, b: 1 } };
  const html = render(view);
  assert.match(html, /accusations sealed/i);
  assert.match(html, /Beverly With A Very Long Name/);
  assert.doesNotMatch(html, /19 votes|Culprit revealed|Case closed|Anonymous suspicion/);
});

test('results keep all twenty vote rows, full scores and the case timeline reviewable', () => {
  const view = room(); view.phase = 'results';
  view.players = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `Guest ${i}`, gender: 'any', connected: true, ready: true, characterId: 'silas-vale', roleName: 'Marshal Silas Vale' }));
  view.result = { culpritId: 'p0', caught: true, tallies: { p0: 12, p19: 1 }, scores: view.players.map((p, i) => ({ playerId: p.id, score: 900 - i * 25, correctAnswers: 2, cluesShared: 3, searches: 3, correctAccusation: i !== 19 })), solution: { headline: 'The Black Star Unmasked', summary: 'The gallery record identifies the killer.', method: 'An induction coil.', motive: 'A private core auction.', timeline: [{ time: '8:57', text: 'The fatal induction strike.' }] } };
  const html = render(view);
  assert.match(html, /The Black Star Unmasked/);
  assert.match(html, /The fatal induction strike/);
  assert.match(html, /Guest 19/);
  assert.match(html, /425/);
  assert.equal((html.match(/data-vote-row=/g) || []).length, 20);
  assert.equal((html.match(/data-score-row=/g) || []).length, 20);
});
