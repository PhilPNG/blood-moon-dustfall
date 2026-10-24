import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '../shared/types';
import type { Language } from '../shared/locale';
import { attentionEventKey } from '../shared/attention';
import { LanguageProvider } from '../src/i18n';
import { AttentionOverlay } from '../src/components/AttentionOverlay';

function view(overrides: Partial<RoomView> = {}): RoomView {
  return {
    code: 'LOOK', phase: 'investigation', round: 1, serverNow: 100_000,
    settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [],
    isLocked: true, timer: { endsAt: 410_000, remaining: 300, isPaused: false },
    clues: [], votesCount: 0, isMaster: false,
    attention: { id: 1, eventKey: attentionEventKey({ code: 'LOOK', phase: 'investigation', round: 1 }), cue: 'phase', endsAt: 110_000, remainingMs: 10_000 },
    ...overrides,
  };
}
function render(room = view(), language: Language = 'en', variant: 'phone' | 'host' | 'master' = 'phone', connected = true) {
  return renderToStaticMarkup(createElement(LanguageProvider, {
    initialLanguage: language,
    children: createElement(AttentionOverlay, { room, variant, connected }),
  }));
}

test('all phone languages invite attention to the shared screen with the same server countdown', () => {
  const expectations = {
    en: ['Eyes on the big screen', 'Look up', 'Next chapter'],
    es: ['Miren la pantalla grande', 'Levanten la mirada', 'Próximo capítulo'],
    'pt-BR': ['Olhem para a tela grande', 'Levantem os olhos', 'Próximo capítulo'],
  };
  for (const language of ['en', 'es', 'pt-BR'] as const) {
    const html = render(view(), language);
    assert.match(html, new RegExp(`lang="${language}"`));
    for (const phrase of expectations[language]) assert.ok(html.includes(phrase), `${language}: ${phrase}`);
    assert.match(html, /role="timer"[^>]*aria-live="off"/);
    assert.match(html, />10<\//);
    if (language !== 'en') assert.doesNotMatch(html, /Eyes on the big screen|Synced with the room/);
  }
});

test('legacy rooms and expired or empty attention windows leave the normal game visible', () => {
  assert.equal(render(view({ attention: undefined })), '');
  assert.equal(render(view({ serverNow: 110_000 })), '');
  assert.equal(render(view({ serverNow: 120_000 })), '');
  assert.equal(render(view({ attention: { ...view().attention!, endsAt: null, remainingMs: 0 } })), '');
});

test('paused attention freezes its saved countdown and distinguishes reconnection from a running clock', () => {
  const room = view({ serverNow: 900_000, timer: { endsAt: null, remaining: 300, isPaused: true }, attention: { ...view().attention!, endsAt: null, remainingMs: 6_100 } });
  const paused = render(room, 'pt-BR');
  assert.match(paused, />7<\//);
  assert.ok(paused.includes('Contagem pausada'));
  const offline = render(room, 'es', 'phone', false);
  assert.ok(offline.includes('Reconectando con la sala'));
  assert.doesNotMatch(offline, /Sincronizados con la sala/);
});

test('the host uses a full-screen stage while the GM gets a compact card without control buttons', () => {
  const host = render(view(), 'en', 'host');
  assert.match(host, /attention--host/);
  assert.ok(host.includes('All eyes on Dustfall'));
  const master = render(view(), 'es', 'master');
  assert.match(master, /attention--master/);
  assert.ok(master.includes('Reúnan al grupo'));
  assert.doesNotMatch(host + master, /<button|<video|<audio/);
});

test('every attention cue remains a public generic label even when private payloads contain spoilers', () => {
  const expected = { phase: 'Next chapter', clue: 'New public evidence', 'timer-warning': 'Host announcement', lobby: 'Welcome to Dustfall' };
  for (const cue of ['phase', 'clue', 'timer-warning', 'lobby'] as const) {
    const room = view({
      attention: { ...view().attention!, cue },
      me: { playerId: 'PRIVATE_PLAYER', ready: false, votedFor: 'PRIVATE_VOTE', clues: [], role: { name: 'PRIVATE_ROLE', gender: 'any', alignment: 'culprit', brief: 'PRIVATE_BRIEF', objective: 'PRIVATE_OBJECTIVE', secret: 'PRIVATE_SECRET' } },
      result: { culpritId: 'PRIVATE_CULPRIT', tallies: { PRIVATE_VOTE: 3 }, caught: true },
    });
    const html = render(room);
    assert.ok(html.includes(expected[cue]));
    assert.doesNotMatch(html, /PRIVATE_|culpritId|eventKey|votedFor|recoveryCode/);
    assert.ok(!html.includes(room.attention!.eventKey), 'The public attention identity is not visible copy');
  }
});
