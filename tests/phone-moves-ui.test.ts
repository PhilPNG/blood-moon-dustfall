import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Player } from '../src/components/Player';
import { LanguageProvider, translate } from '../src/i18n';
import type { RoomView } from '../shared/types';
import type { Language } from '../shared/locale';

function room(): RoomView {
  return { code: 'MOVE', gameId: 'moves-game', phase: 'investigation', round: 1,
    settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [{ id: 'me', name: 'Guest', gender: 'any', ready: true, connected: true }],
    isLocked: true, isMaster: false, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0,
    me: { playerId: 'me', ready: true, votedFor: null, clues: [{ id: 'mine', round: 1, playerId: 'me', playerName: 'Guest', title: 'PRIVATE TITLE', text: 'PRIVATE CLUE DETAILS', published: false }] },
    act: { title: 'Act one', narration: '', prompt: 'Compare the evidence.', evidence: [], locations: [{ id: 'saloon', label: 'Saloon', description: 'Search here' }], question: { id: 'q', prompt: 'What happened?', options: [{ id: 'a', text: 'SECRET ANSWER CHOICE' }] } },
  };
}
function render(view: RoomView, language: Language = 'en', connected = true) {
  return renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(Player, { room: view, connected, command: async () => {}, onLeave: () => {} }) }));
}
function card(html: string) {
  const found = html.match(/<section[^>]*class="phone-moves"[^>]*>[\s\S]*?<\/section>/)?.[0];
  assert.ok(found, 'The private case tab needs a current-act move navigator'); return found;
}

test('player gets three navigation shortcuts with progress and no private contents in the card', () => {
  const html = render(room()), moves = card(html);
  for (const label of ['Your moves this act', '0 of 3 complete', 'Search', 'Share clue', 'Case answer']) assert.ok(moves.includes(label), label);
  assert.equal((moves.match(/<button\b/g) ?? []).length, 3);
  for (const id of ['search', 'share', 'answer']) assert.ok(moves.includes(`data-move="${id}"`));
  assert.match(moves, /role="progressbar"[^>]*aria-valuenow="0"/);
  assert.doesNotMatch(moves, /disabled|PRIVATE TITLE|PRIVATE CLUE DETAILS|SECRET ANSWER CHOICE/);
  for (const id of ['phone-search-heading', 'phone-answer-heading']) assert.match(html, new RegExp(`id="${id}"[^>]*tabindex="-1"`));
  assert.match(html, /class="phone-accordion phone-private-clues"/);
});

test('completion follows server receipts and navigation remains available while paused or reconnecting', () => {
  const view = room(); view.me!.search = { locationId: 'saloon', title: 'PRIVATE FIND', text: 'PRIVATE SEARCH' };
  view.me!.answeredOptionId = 'a'; view.me!.clues[0].published = true;
  for (const connected of [true, false]) {
    view.timer.isPaused = !connected;
    const moves = card(render(view, 'en', connected));
    assert.ok(moves.includes('3 of 3 complete'));
    assert.ok(moves.includes('All set. Compare evidence and question alibis.'));
    assert.equal((moves.match(/data-status="done"/g) ?? []).length, 3);
    assert.doesNotMatch(moves, /disabled|PRIVATE FIND|PRIVATE SEARCH|SECRET ANSWER CHOICE/);
  }
});

test('waiting, new acts and non-investigation phases never claim previous tasks are complete', () => {
  const view = room(); view.round = 2; view.me!.clues[0].published = true;
  const moves = card(render(view));
  assert.ok(moves.includes('0 of 3 complete'));
  assert.ok(moves.includes('Clue on its way'));
  assert.ok(moves.includes('data-status="waiting"'));
  for (const phase of ['lobby', 'roles', 'voting', 'results'] as const) assert.doesNotMatch(render({ ...room(), phase }), /class="phone-moves"/);
});

test('move labels, progress and all-set guidance localize in Spanish and Brazilian Portuguese', () => {
  const expected = { es: ['Tus acciones de este acto', '0 de 3 completadas', 'Buscar', 'Compartir pista', 'Responder'], 'pt-BR': ['Suas ações neste ato', '0 de 3 concluídas', 'Buscar', 'Compartilhar pista', 'Responder'] };
  for (const language of ['es', 'pt-BR'] as const) {
    const moves = card(render(room(), language));
    for (const label of expected[language]) assert.ok(moves.includes(label), `${language}: ${label}`);
    assert.doesNotMatch(moves, /Your moves this act|>Search<|Share clue|Case answer/);
    for (const source of ['Your completed moves', '{done} of {total} complete', '{move}: {status}. Jump to controls', 'Clue on its way', 'To do', 'Done', '{shared}/{total} shared', 'All set. Compare evidence and question alibis.', 'Tap a move to jump to its controls. You decide what to share.']) assert.notEqual(translate(language, source), source, `${language}: ${source}`);
  }
});
