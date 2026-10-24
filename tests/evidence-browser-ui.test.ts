import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Player } from '../src/components/Player';
import { LanguageProvider, translate } from '../src/i18n';
import { readFileSync } from 'node:fs';
import type { RoomView } from '../shared/types';
import type { Language } from '../shared/locale';
import { evidenceStorageKey } from '../shared/evidence-browser';

function room(phase: RoomView['phase']): RoomView {
  return {
    code: 'DUST', gameId: 'public-evidence-game', phase, round: 2,
    settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [],
    isLocked: true, timer: { endsAt: null, remaining: 300, isPaused: false }, votesCount: 0, isMaster: false,
    me: { playerId: 'guest', ready: true, votedFor: null, clues: [] },
    act: { title: 'Act II', narration: '', prompt: '', evidence: [{ id: 'same-id', title: 'The electrical mark', text: 'A branching burn on the brass medallion.' }], locations: [], question: { id: 'q', prompt: '', options: [] } },
    clues: [
      { id: 'same-id', title: 'The shared revolver', text: 'A spent blank belongs to the staged shot.', round: 1, playerId: 'witness', playerName: 'Ada', published: true },
      { id: 'private-id', title: 'UNPUBLISHED TITLE', text: 'UNPUBLISHED SECRET', round: 2, playerId: 'other', playerName: 'PRIVATE WITNESS', published: false },
    ],
  };
}
function render(view: RoomView, language: Language = 'en', connected = true) {
  return renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(Player, { room: view, connected, command: async () => {}, onLeave: () => {} }) }));
}

test('investigation, voting and results offer searchable public evidence with distinct pinnable cards', () => {
  for (const phase of ['investigation', 'voting', 'results'] as const) {
    const html = render(room(phase));
    assert.ok(html.includes('Search public evidence'), `${phase} needs a public search control`);
    assert.match(html, /type="search"/);
    assert.ok(html.includes('Evidence filters'));
    for (const label of ['All evidence', 'Case evidence', 'Shared clues', 'Pinned']) assert.ok(html.includes(label), `${phase}: ${label}`);
    assert.ok(html.includes('Showing 2 of 2'));
    assert.match(html, /aria-label="Pin The electrical mark"/);
    assert.match(html, /aria-label="Pin The shared revolver"/);
    assert.match(html, /data-evidence-key="case:same-id"/);
    assert.match(html, /data-evidence-key="shared:same-id"/);
    assert.doesNotMatch(html, /UNPUBLISHED|PRIVATE WITNESS|private-id/);
  }
});

test('the evidence tools are localized and remain available offline and while paused', () => {
  const expected = {
    es: ['Buscar pruebas públicas', 'Todas las pruebas', 'Pruebas del caso', 'Pistas compartidas', 'Fijadas'],
    'pt-BR': ['Buscar evidências públicas', 'Todas as evidências', 'Evidências do caso', 'Pistas compartilhadas', 'Fixadas'],
  };
  for (const language of ['es', 'pt-BR'] as const) {
    const view = room('investigation'); view.timer.isPaused = true;
    const html = render(view, language, false);
    for (const label of expected[language]) assert.ok(html.includes(label), `${language}: ${label}`);
    assert.doesNotMatch(html, /Search public evidence|Evidence filters|Pin The electrical mark/);
    const pinButton = html.match(/<button[^>]*class="phone-evidence-pin[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.ok(pinButton, 'Evidence pin action must render');
    assert.doesNotMatch(pinButton, /disabled/);
  }
});

test('stored public pin IDs restore only for the current game and seat', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const view = room('voting');
  const storage = new Map([[evidenceStorageKey(view), JSON.stringify(['shared:same-id', 'shared:private-id'])]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem(key: string) { return storage.get(key) ?? null; } } });
  try {
    const html = render(view);
    assert.match(html, /aria-label="Unpin The shared revolver"/);
    assert.match(html, /aria-label="Pin The electrical mark"/);
    assert.doesNotMatch(html, /private-id|UNPUBLISHED/);
    assert.ok(html.includes('Showing 2 of 2'));
    for (const isolated of [{ ...view, gameId: 'another-game' }, { ...view, me: { ...view.me!, playerId: 'another-seat' } }]) {
      const fresh = render(isolated);
      assert.ok(fresh.includes('aria-label="Pin The shared revolver"'));
      assert.ok(!fresh.includes('aria-label="Unpin The shared revolver"'));
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('all evidence-tool labels, receipts and recovery messages have both translations', () => {
  const source = readFileSync(new URL('../src/components/PublicEvidence.tsx', import.meta.url), 'utf8');
  const literals = [...source.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]);
  const dynamic = ['All evidence', 'Case evidence', 'Shared clues', 'Pinned', 'Pin', 'Unpin', 'Pin {title}', 'Unpin {title}', 'Pinned {title}', 'Unpinned {title}'];
  for (const key of [...literals, ...dynamic]) for (const language of ['es', 'pt-BR'] as const) {
    assert.notEqual(translate(language, key), key, `${language}: ${key}`);
  }
});
