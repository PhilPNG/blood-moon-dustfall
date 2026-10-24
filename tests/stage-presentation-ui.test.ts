import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '../shared/types';
import { LanguageProvider } from '../src/i18n';
import { DistanceInvestigation, StagePreflightStatus, StageSpotlight } from '../src/components/StagePresentation';
import { Display } from '../src/components/Display';
import { attentionEventKey } from '../shared/attention';

const room = (patch: Partial<RoomView> = {}): RoomView => ({ code: 'SHOW', phase: 'investigation', round: 1, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: true, isMaster: false, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [{ id: 'private', title: 'PRIVATE SECRET', text: 'PRIVATE DOSSIER', playerId: 'guest', playerName: 'Guest', round: 1, published: false }, { id: 'shared', title: 'PUBLIC SIGNAL', text: 'A public clue for the party.', playerId: 'guest', playerName: 'Guest', round: 1, published: true }], votesCount: 0, act: { title: 'Act I · Follow the signal', narration: 'Public story', prompt: 'What proves the alibi?', evidence: [], locations: [], question: { id: 'q', prompt: 'Public case question', options: [{ id: 'a', text: 'A public option' }] } }, ...patch });
const render = (component: typeof DistanceInvestigation | typeof StageSpotlight | typeof StagePreflightStatus, props: Record<string, unknown>, language: 'en' | 'es' | 'pt-BR' = 'en') => renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(component as typeof DistanceInvestigation, props as never) }));

test('distance cards render public evidence and readable phone instructions without private or answer information', () => {
  const html = render(DistanceInvestigation, { room: room(), blocked: false });
  assert.match(html, /stage-distance-layout/); assert.match(html, /PUBLIC SIGNAL/); assert.match(html, /What proves the alibi/);
  assert.doesNotMatch(html, /PRIVATE SECRET|PRIVATE DOSSIER/);
  assert.match(html, /14/);
});

test('spotlight is a public card only after its presentation gate and clears immediately for private targets', () => {
  const view = room({ spotlight: { evidenceId: 'shared:shared', serial: 1 } });
  assert.match(render(StageSpotlight, { room: view, blocked: false }), /PUBLIC SIGNAL/);
  assert.equal(render(StageSpotlight, { room: view, blocked: true }), '');
  assert.equal(render(StageSpotlight, { room: { ...view, spotlight: { evidenceId: 'shared:private', serial: 2 } }, blocked: false }), '');
  assert.equal(render(StageSpotlight, { room: { ...view, spotlight: undefined }, blocked: false }), '');
});

test('a setup playback check does not claim the clip ended or anyone heard its sound in every language', () => {
  for (const [language, expected, status] of [['en', 'Confirm sound', 'Screen test playback checked'], ['es', 'Confirma el sonido', 'Reproducción de prueba de pantalla comprobada'], ['pt-BR', 'Confirme o som', 'Reprodução do teste de tela verificada']] as const) {
    const html = render(StagePreflightStatus, { room: room({ phase: 'lobby', preflight: { serial: 1, completed: true } }) }, language);
    assert.ok(html.includes(expected)); assert.ok(html.includes(status));
    assert.doesNotMatch(html, /audio verified|sound verified|Test clip finished|Clip de prueba terminado|Clipe de teste concluído/i);
  }
});

test('the TV shows a read-only fun-awards participation board after the verdict and defers it behind attention', () => {
  const view = room({ phase: 'results', partyAwards: { id: 1, status: 'voting', submittedCount: 1, eligibleCount: 4 }, result: { culpritId: 'guest', caught: true, tallies: {} } });
  const html = renderToStaticMarkup(createElement(Display, { room: view, connected: true, joinOrigin: 'https://example.test' }));
  assert.match(html, /1 of 4 party ballots sealed/); assert.doesNotMatch(html, /award-ballot|Reveal awards|Skip party awards/);
  const pending = { ...view, serverNow: 100_000, attention: { id: 1, eventKey: attentionEventKey(view), cue: 'phase' as const, endsAt: 110_000, remainingMs: 10_000 } };
  const waiting = renderToStaticMarkup(createElement(Display, { room: pending, connected: true, joinOrigin: 'https://example.test' }));
  assert.doesNotMatch(waiting, /1 of 4 party ballots sealed/);
});

test('active TV awards occupy the main stage before the collapsed case file, with three public category panels', () => {
  const view = room({ phase: 'results', partyAwards: { id: 1, status: 'voting', submittedCount: 1, eligibleCount: 4 }, result: { culpritId: 'guest', caught: true, tallies: {} } });
  const html = renderToStaticMarkup(createElement(Display, { room: view, connected: true, joinOrigin: 'https://example.test' }));
  assert.match(html, /<main class="stage-party-awards-layout"/);
  assert.equal((html.match(/party-awards--host/g) ?? []).length, 1);
  assert.ok(html.indexOf('Party awards') < html.indexOf('The complete case file'));
  assert.match(html, /<details class="stage-verdict-review"><summary>Review the verdict<\/summary>/);
  assert.equal((html.match(/class="party-award-category"/g) ?? []).length, 3);
  assert.match(html, /Vote on your phone/);
  assert.doesNotMatch(html, /party-award-ballot|Reveal awards|Skip party awards/);
});

test('revealed awards keep their stage, while skipped awards return to the normal case results', () => {
  const view = room({ phase: 'results', partyAwards: { id: 1, status: 'revealed', submittedCount: 1, eligibleCount: 4, results: [{ category: 'poker-face', tallies: { guest: 1 }, winnerIds: ['guest'] }] }, result: { culpritId: 'guest', caught: true, tallies: {} } });
  const revealed = renderToStaticMarkup(createElement(Display, { room: view, connected: true, joinOrigin: 'https://example.test' }));
  assert.match(revealed, /stage-party-awards-layout/); assert.match(revealed, /party-award-winners/);
  const skipped = renderToStaticMarkup(createElement(Display, { room: { ...view, partyAwards: { ...view.partyAwards!, status: 'skipped' } }, connected: true, joinOrigin: 'https://example.test' }));
  assert.match(skipped, /stage-results-layout/); assert.doesNotMatch(skipped, /stage-party-awards-layout|party-awards--host|stage-verdict-review/);
});
