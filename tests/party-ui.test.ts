import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '../shared/types';
import type { Language } from '../shared/locale';
import { attentionEventKey } from '../shared/attention';
import { LanguageProvider } from '../src/i18n';
import { HostPreflight } from '../src/components/HostPreflight';
import { StageControls } from '../src/components/StageControls';
import { MinglingCard } from '../src/components/MinglingCard';
import { FunAwards } from '../src/components/FunAwards';
import { SpectatorPanel } from '../src/components/SpectatorPanel';
function room(overrides: Partial<RoomView> = {}): RoomView {
  return { code: 'FEST', gameId: 'public-game', phase: 'investigation', round: 1, serverNow: 100_000, expiresAt: 500_000, settings: { maxPlayers: 20, rounds: 3, roundSeconds: 300 }, players: [{ id: 'a', name: 'Alice', gender: 'any', ready: true, connected: true }, { id: 'b', name: 'Bea', gender: 'woman', ready: true, connected: true }, { id: 'c', name: 'Carl', gender: 'man', ready: true, connected: false }], isLocked: true, timer: { endsAt: 400_000, remaining: 300, isPaused: false }, clues: [{ id: 'public', title: 'Public card', text: 'Public detail', round: 1, playerId: 'b', playerName: 'Bea', published: true }, { id: 'private', title: 'PRIVATE_CLUE', text: 'PRIVATE_DETAIL', round: 1, playerId: 'a', playerName: 'Alice', published: false }], votesCount: 0, isMaster: false, me: { playerId: 'a', ready: true, votedFor: 'PRIVATE_VOTE', clues: [], role: { name: 'PRIVATE_ROLE', gender: 'any', alignment: 'culprit', brief: 'PRIVATE_BRIEF', objective: 'PRIVATE_OBJECTIVE', secret: 'PRIVATE_SECRET' } }, ...overrides };
}
const handlers = { connected: true, onAction: async () => {}, onJoin: () => {}, onHome: () => {} };
function render(component: ComponentType<any>, view: RoomView, language: Language = 'en', extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(component, { room: view, ...handlers, ...extra }) }));
}
test('all new private and public surfaces support English, Spanish and Brazilian Portuguese', () => {
  const expected = { en: ['Optional table talk','Party check','Stage and sound','Party awards','Audience mode'], es: ['Charla opcional','Preparar la fiesta','Pantalla y sonido','Premios de la fiesta','Modo público'], 'pt-BR': ['Conversa opcional','Preparar a festa','Tela e som','Prêmios da festa','Modo de plateia'] };
  for (const language of ['en','es','pt-BR'] as const) {
    const views = [render(MinglingCard, room(), language), render(HostPreflight, room({ isMaster: true, phase: 'lobby' }), language), render(StageControls, room({ isMaster: true }), language), render(FunAwards, room({ isMaster: true, phase: 'results' }), language), render(SpectatorPanel, room({ me: undefined }), language)];
    views.forEach((html, index) => assert.ok(html.includes(expected[language][index]), `${language}: ${expected[language][index]}`));
  }
});
test('mingle cards are private optional aids without story disclosures or compulsory scoring', () => {
  const html = render(MinglingCard, room());
  assert.ok(html.includes('Bea'));
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /PRIVATE_|\+25|\+100|<form/);
  assert.equal(render(MinglingCard, room({ me: undefined })), '');
});
test('preflight is GM/lobby-only and distinguishes a connected display from manually confirmed sound', () => {
  const html = render(HostPreflight, room({ isMaster: true, phase: 'lobby', displayConnected: true }));
  assert.ok(html.includes('TV connected'));
  assert.ok(html.includes('I heard sound on the TV'));
  assert.ok(html.includes('Run screen test'));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /checked=""|PRIVATE_|Start game/);
  assert.equal(render(HostPreflight, room({ phase: 'lobby' })), '');
  assert.equal(render(HostPreflight, room({ isMaster: true })), '');
});
test('a late TV test report never claims native completion or checks manual sound confirmations', () => {
  const expected = { en: 'The TV reported the test playback.', es: 'La pantalla informó de la reproducción de prueba.', 'pt-BR': 'A TV informou a reprodução do teste.' };
  for (const language of ['en','es','pt-BR'] as const) {
    const html = render(HostPreflight, room({ isMaster: true, phase: 'lobby', preflight: { serial: 1, completed: true } }), language);
    assert.ok(html.includes(expected[language]));
    assert.doesNotMatch(html, /test film finished|película de prueba terminó|filme de teste terminou|checked=""/);
  }
});
test('legacy stage controls enable music at 25 percent while preserving an explicit off preference and public-only spotlight', () => {
  const html = render(StageControls, room({ isMaster: true }));
  assert.ok(html.includes('Enable Sound on the TV'));
  assert.match(html, /value="25" selected=""/);
  assert.ok(html.includes('value="shared:public"'));
  assert.doesNotMatch(html, /PRIVATE_|shared:private/);
  const checkboxes = [...html.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(match => match[0]);
  assert.equal(checkboxes.length, 2);
  assert.doesNotMatch(checkboxes[0], /checked=""/, 'Distance mode stays opt-in');
  assert.match(checkboxes[1], /checked=""/, 'Missing stage settings use the new music-on default');
  const muted = render(StageControls, room({ isMaster: true, stageSettings: { distanceMode: false, musicEnabled: false, musicVolume: 25 } }));
  assert.doesNotMatch(muted, /checked=""/, 'An explicit saved music-off choice survives');
  assert.equal(render(StageControls, room()), '');
});
test('a live attention window disables GM spotlight while an expired window releases it', () => {
  const original = room({ isMaster: true });
  const attention = { id: 1, eventKey: attentionEventKey(original), cue: 'spotlight' as const, endsAt: 110_000, remainingMs: 10_000 };
  assert.match(render(StageControls, { ...original, attention }), /<select[^>]*data-spotlight[^>]*disabled=""/);
  assert.doesNotMatch(render(StageControls, { ...original, attention, serverNow: 111_000 }), /<select[^>]*data-spotlight[^>]*disabled=""/);
});
test('the GM can cancel a pending own spotlight while selecting another card remains disabled', () => {
  const original = room({ isMaster: true, spotlight: { evidenceId: 'shared:public', serial: 1 } });
  const html = render(StageControls, { ...original, attention: { id: 1, eventKey: attentionEventKey(original), cue: 'spotlight', endsAt: 110_000, remainingMs: 10_000 } });
  assert.match(html, /<select[^>]*data-spotlight[^>]*disabled=""/);
  const clear = html.match(/<button([^>]*)>(?:(?!<\/button>)[\s\S])*?Clear spotlight<\/button>/);
  assert.ok(clear, 'The pending card needs a clear action');
  assert.doesNotMatch(clear[1], /disabled/);
});
test('fun ballots exclude self and freeze their own saved choices while public tallies stay sealed', () => {
  const partyAwards = { id: 4, status: 'voting' as const, submittedCount: 1, eligibleCount: 3, results: [{ category: 'poker-face' as const, tallies: { SECRET_TALLY: 9 }, winnerIds: ['SECRET_WINNER'] }] };
  const html = render(FunAwards, room({ phase: 'results', partyAwards }));
  assert.equal((html.match(/<select/g) ?? []).length, 3);
  assert.doesNotMatch(html, /value="a"|SECRET_|PRIVATE_/);
  const saved = render(FunAwards, room({ phase: 'results', partyAwards, me: { ...room().me!, partyAwardChoices: { 'poker-face': 'b', 'in-character': 'b', 'wild-accusation': 'c' } } }));
  assert.ok(saved.includes('Your party ballot is sealed'));
  assert.doesNotMatch(saved, /<select|SECRET_/);
});
test('spectators never receive award controls, private choices, dossiers or player actions even with a private input view', () => {
  const html = render(SpectatorPanel, room({ isMaster: true, phase: 'results', partyAwards: { id: 4, status: 'voting', submittedCount: 1, eligibleCount: 3 } }));
  assert.ok(html.includes('Audience mode'));
  assert.ok(html.includes('Public card'));
  assert.doesNotMatch(html, /PRIVATE_|<select|Seal my party ballot|Reveal awards|Take over|Reveal my secret|Make my accusation|Recovery code/);
});
test('public award results show all tied winners without offering ballots', () => {
  const html = render(FunAwards, room({ phase: 'results', me: undefined, partyAwards: { id: 4, status: 'revealed', submittedCount: 2, eligibleCount: 3, results: [{ category: 'poker-face', tallies: { b: 1, c: 1 }, winnerIds: ['b','c'] }] } }), 'en', { variant: 'host' });
  assert.ok(html.includes('Bea'));
  assert.ok(html.includes('Carl'));
  assert.ok(html.includes('Tied winners'));
  assert.doesNotMatch(html, /<select|Seal my party ballot/);
});
test('audience joining is only offered for an unlocked lobby with spare capacity', () => {
  const open = render(SpectatorPanel, room({ phase: 'lobby', isLocked: false, me: undefined }));
  assert.ok(open.includes('Join as a player'));
  for (const state of [room({ phase: 'investigation' }), room({ phase: 'lobby', isLocked: true }), room({ phase: 'lobby', isLocked: false, settings: { ...room().settings, maxPlayers: 3 } })]) {
    const html = render(SpectatorPanel, state);
    assert.ok(html.includes('Join the next mystery'));
    assert.doesNotMatch(html, /Join as a player/);
  }
});
test('skipped awards can reopen, sample nominees are labelled, and sample-only tables cannot open a ballot', () => {
  const skipped = render(FunAwards, room({ isMaster: true, phase: 'results', partyAwards: { id: 4, status: 'skipped', submittedCount: 0, eligibleCount: 3 } }));
  assert.ok(skipped.includes('Reopen party awards'));
  const original = room();
  const withSample = { ...original, phase: 'results' as const, players: [...original.players, { id: 'demo', name: 'Sample Four', connected: true, gender: 'any' as const, ready: true, isDemo: true }], partyAwards: { id: 4, status: 'voting' as const, submittedCount: 0, eligibleCount: 3 } };
  const ballot = render(FunAwards, withSample);
  assert.match(ballot, /value="demo"/);
  assert.ok(ballot.includes('Sample player'));
  const onlySamples = render(FunAwards, room({ phase: 'results', isMaster: true, me: undefined, players: withSample.players.map(player => ({ ...player, isDemo: true })) }));
  assert.match(onlySamples, /<button[^>]*disabled=""[^>]*>[\s\S]*Open party awards/);
  assert.ok(onlySamples.includes('At least one real player and another cast member are needed.'));
});
test('a host variant stays read-only even if given a master view accidentally', () => {
  assert.equal(render(FunAwards, room({ isMaster: true, phase: 'results' }), 'en', { variant: 'host' }), '');
});
