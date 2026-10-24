import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '../shared/types';
import { LanguageProvider } from '../src/i18n';
import type { Language } from '../shared/locale';
import { CinematicPlayer } from '../src/components/CinematicPlayer';

const room: RoomView = { code: 'SHOW', gameId: 'film', phase: 'roles', round: 0, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: true, isMaster: false, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0 };

function filmOverlay(language: Language, { sound = true, mediaLeader = true, needsResume = true, pending = false } = {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => ({ matches: false }) } });
  try {
    const html = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(CinematicPlayer, { room, connected: true, sound, mediaLeader, soundNeedsResume: needsResume, soundPending: pending, toggleSound() {}, muteSound() {}, children: () => null }) }));
    const start = html.indexOf('<section class="cinema-overlay"');
    assert.ok(start >= 0, 'the public film must own the recovery controls');
    return html.slice(start, html.indexOf('</section>', start));
  } finally { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); }
}

test('the active film dialog exposes localized recovery and mute controls while the Sound preference stays on', () => {
  for (const [language, resume, mute] of [['en', 'Resume sound', 'Keep sound muted'], ['es', 'Reanudar sonido', 'Mantener el sonido apagado'], ['pt-BR', 'Retomar som', 'Manter o som desligado']] as const) {
    const overlay = filmOverlay(language);
    assert.match(overlay, /role="dialog" aria-modal="true"/);
    assert.ok(overlay.includes(`>${resume}</button>`), language);
    assert.ok(overlay.includes(`>${mute}</button>`), language);
    assert.doesNotMatch(overlay, /Enable sound/);
    assert.match(overlay, /Skip film/);
  }
});

test('a passive film keeps its active-TV explanation and local mute without offering to resume authority', () => {
  const overlay = filmOverlay('en', { mediaLeader: false });
  assert.ok(overlay.includes('Game audio plays on the active TV.'));
  assert.ok(overlay.includes('>Keep sound muted</button>'));
  assert.doesNotMatch(overlay, /Resume sound|Enable sound/);
});

test('recovery controls disappear when running or muted, and an in-flight resume cannot be tapped twice', () => {
  const running = filmOverlay('en', { needsResume: false });
  assert.doesNotMatch(running, /Resume sound|Keep sound muted|Enable sound/);
  const muted = filmOverlay('en', { sound: false, needsResume: false });
  assert.match(muted, /Enable sound/);
  assert.doesNotMatch(muted, /Resume sound|Keep sound muted/);
  const pending = filmOverlay('en', { pending: true });
  const recovery = pending.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes('Resuming sound'));
  assert.ok(recovery);
  assert.match(recovery, /disabled/);
  assert.ok(pending.includes('>Keep sound muted</button>'), 'mute must stay available if native resume never settles');
});
