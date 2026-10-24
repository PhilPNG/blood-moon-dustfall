import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView, Session } from '../shared/types';
import type { Language } from '../shared/locale';
import { LanguageProvider } from '../src/i18n';
import * as recovery from '../src/components/RoomRecovery';
import * as client from '../src/client';

function view(overrides: Partial<RoomView> = {}): RoomView {
  return {
    code: 'UIRR', phase: 'lobby', round: 0, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 },
    players: [{ id: 'guest', name: 'Ada', gender: 'any', ready: false, connected: true }, { id: 'other', name: 'Bea', gender: 'woman', ready: true, connected: true }, { id: 'sample', name: 'Sample suspect', gender: 'any', ready: true, connected: true, isDemo: true }],
    isLocked: false, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0, isMaster: false,
    me: { playerId: 'guest', clues: [], ready: false, votedFor: null }, serverNow: 100_000,
    gameMaster: { id: 'owner', name: 'Marshal Phil', connected: true, epoch: 1 }, ...overrides,
  };
}
function render(name: keyof NonNullable<typeof recovery>, props: Record<string, unknown>, language: Language = 'en') {
  assert.ok(recovery, 'The recovery UI must be implemented');
  const component = recovery[name];
  assert.equal(typeof component, 'function', `${name} must be a component`);
  return renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(component as ComponentType<Record<string, unknown>>, props) }));
}
function storage() {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; }, getItem(key: string) { return values.get(key) ?? null; }, setItem(key: string, value: string) { values.set(key, value); }, removeItem(key: string) { values.delete(key); }, clear() { values.clear(); } };
}
async function withSessions(run: () => void) {
  assert.ok(recovery, 'The recovery UI must be implemented');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() });
  const { saveSession, forgetSession } = await import('../src/client');
  const player: Session = { code: 'UIRR', token: 'PRIVATE-PLAYER-BEARER', playerId: 'guest', name: 'Ada', characterName: 'Marshal Silas Vale', recoveryCode: 'ABCD2345EFGH', expiresAt: Date.now() + 60_000 };
  const master: Session = { code: 'UIRR', token: 'PRIVATE-MASTER-BEARER', name: 'Marshal Phil', recoveryCode: 'JKMN6789PQRS', expiresAt: Date.now() + 60_000 };
  saveSession('player', player); saveSession('master', master);
  try { run(); }
  finally {
    forgetSession('player', 'UIRR'); forgetSession('master', 'UIRR');
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('public GM identity reveals neither private credentials nor control actions', () => {
  const html = render('GameMasterStatus', { room: view({ gameMaster: { id: 'PRIVATE-GM-IDENTITY', name: 'Marshal Phil', connected: false, epoch: 2, takeoverAt: 160_000, eligiblePlayerId: 'guest', handoff: { playerId: 'guest', expiresAt: 180_000 } } }) });
  assert.ok(html.includes('Marshal Phil'));
  assert.ok(html.includes('Reconnecting'));
  assert.doesNotMatch(html, /PRIVATE|eligiblePlayerId|handoff|<button|href=|recoveryCode|160000/);
  assert.equal(render('GameMasterStatus', { room: view({ gameMaster: undefined }) }), '');
});

test('private recovery stays hidden until revealed and dual identities have separate safe links', async () => {
  await withSessions(() => {
    for (const [component, room] of [['PlayerRecovery', view()], ['MasterRecovery', view({ isMaster: true })]] as const) {
      const html = render(component, { room, connected: true, onMasterSession: () => {}, onReleased: () => {} });
      assert.ok(html.includes('Reveal recovery code'));
      assert.match(html, /href="\/play\/UIRR"/);
      assert.match(html, /href="\/master\/UIRR"/);
      assert.doesNotMatch(html, /PRIVATE-PLAYER-BEARER|PRIVATE-MASTER-BEARER|ABCD2345EFGH|JKMN6789PQRS|ABCD 2345 EFGH|JKMN 6789 PQRS/);
    }
  });
});

test('late recovery-code results cannot replace a newer code, bearer or public profile', async () => {
  await withSessions(() => {
    assert.equal(typeof recovery.saveRecoveryCode, 'function', 'Generated codes need an ordering-aware save');
    const { getSession, saveSession } = client;
    const original = { ...getSession('player', 'UIRR')!, recoveryRevision: 1 };
    saveSession('player', { ...original, recoveryCode: 'LMNP2345QRST', recoveryRevision: 3, name: 'Ada updated', characterName: 'Dr. Juniper Moss' });
    assert.equal(recovery.saveRecoveryCode('player', original, { ...original, recoveryCode: 'BCDF2345GHJK', recoveryRevision: 2 }), 'stale');
    assert.equal(getSession('player', 'UIRR')!.recoveryCode, 'LMNP2345QRST');
    assert.equal(recovery.saveRecoveryCode('player', original, { ...original, recoveryCode: 'WXYZ6789BCDF', recoveryRevision: 4 }), 'saved');
    assert.equal(getSession('player', 'UIRR')!.recoveryCode, 'WXYZ6789BCDF');
    assert.equal(getSession('player', 'UIRR')!.name, 'Ada updated');
    assert.equal(getSession('player', 'UIRR')!.characterName, 'Dr. Juniper Moss');
    saveSession('player', { ...original, token: 'replacement-player-token', recoveryCode: 'RSTU4567VWXY', recoveryRevision: 5 });
    assert.equal(recovery.saveRecoveryCode('player', original, { ...original, recoveryCode: 'CDEF2345GHJK', recoveryRevision: 6 }), 'stale');
    assert.equal(getSession('player', 'UIRR')!.token, 'replacement-player-token');
  });
});

test('saved games identify the returning player and character without putting secrets in links', async () => {
  await withSessions(() => {
    const html = render('SavedGames', {});
    assert.ok(html.includes('Ada')); assert.ok(html.includes('Marshal Silas Vale')); assert.ok(html.includes('Marshal Phil'));
    assert.match(html, /href="\/play\/UIRR"/); assert.match(html, /href="\/master\/UIRR"/);
    assert.doesNotMatch(html, /PRIVATE-|ABCD2345EFGH|JKMN6789PQRS|token=|recoveryCode=/);
    const playerOnly = render('SavedGames', { code: 'UIRR', kind: 'player' });
    assert.match(playerOnly, /href="\/play\/UIRR"/); assert.doesNotMatch(playerOnly, /href="\/master\/UIRR"/);
  });
});

test('only a seated guest sees release and targeted transfer actions, and release ends at game start', async () => {
  await withSessions(() => {
    const props = { connected: true, onMasterSession: () => {}, onReleased: () => {} };
    assert.ok(render('PlayerRecovery', { ...props, room: view() }).includes('Release lobby seat'));
    for (const phase of ['roles', 'investigation', 'voting', 'results'] as const) assert.ok(!render('PlayerRecovery', { ...props, room: view({ phase }) }).includes('Release lobby seat'));
    const offered = view({ gameMaster: { id: 'owner', name: 'Marshal Phil', connected: true, epoch: 1, handoff: { playerId: 'guest', expiresAt: 120_000 } } });
    assert.ok(render('PlayerRecovery', { ...props, room: offered }).includes('Accept game master role'));
    assert.ok(!render('PlayerRecovery', { ...props, room: { ...offered, gameMaster: { ...offered.gameMaster!, handoff: { playerId: 'other', expiresAt: 120_000 } } } }).includes('Accept game master role'));
    assert.ok(!render('PlayerRecovery', { ...props, room: { ...offered, serverNow: 120_000 } }).includes('Accept game master role'));
    assert.equal(render('PlayerRecovery', { ...props, room: view({ me: undefined }) }), '');
    assert.equal(render('MasterRecovery', { room: view(), connected: true }), '');
  });
});

test('a takeover requires the selected guest, elapsed grace, and a working connection', async () => {
  await withSessions(() => {
    const props = { connected: true, onMasterSession: () => {}, onReleased: () => {} };
    const absent = view({ gameMaster: { id: 'owner', name: 'Marshal Phil', connected: false, epoch: 1, takeoverAt: 160_000, eligiblePlayerId: 'guest' } });
    const before = render('PlayerRecovery', { ...props, room: absent });
    assert.match(before, /<button[^>]*disabled=""[^>]*>Take over as game master/);
    const at = render('PlayerRecovery', { ...props, room: { ...absent, serverNow: 160_000 } });
    assert.match(at, /<button(?![^>]*disabled)[^>]*>Take over as game master/);
    const offline = render('PlayerRecovery', { ...props, connected: false, room: { ...absent, serverNow: 160_000 } });
    assert.match(offline, /<button[^>]*disabled=""[^>]*>Take over as game master/);
    const wrongGuest = render('PlayerRecovery', { ...props, room: { ...absent, gameMaster: { ...absent.gameMaster!, eligiblePlayerId: 'other' } } });
    assert.ok(!wrongGuest.includes('Take over as game master'));
    const reconnected = render('PlayerRecovery', { ...props, room: view({ gameMaster: { ...absent.gameMaster!, connected: true } }) });
    assert.ok(!reconnected.includes('Take over as game master'));
  });
});

test('GM profile and handoff choices exclude demo players and disable network actions offline', async () => {
  await withSessions(() => {
    const html = render('MasterRecovery', { room: view({ isMaster: true }), connected: false });
    assert.ok(html.includes('Game master name')); assert.ok(html.includes('Backup game master'));
    assert.ok(html.includes('Ada')); assert.ok(html.includes('Bea'));
    assert.ok(!html.includes('Sample suspect'));
    assert.match(html, /<fieldset[^>]*disabled=""/);
  });
});

test('replacement-device form uses private input and an explicit role without URL credentials', () => {
  const html = render('RecoverSessionForm', { initialCode: 'uirr', initialKind: 'master', onRecovered: () => {} });
  assert.match(html, /value="UIRR"/); assert.match(html, /type="password"/);
  assert.match(html, /<option value="master" selected=""/);
  assert.ok(html.includes('Previous devices lose access'));
  assert.doesNotMatch(html, /token=|recoveryCode=|action="\/recover/);
});

test('all recovery surfaces translate visible copy into Spanish and Brazilian Portuguese', async () => {
  await withSessions(() => {
    const expectations = {
      es: ['Tus partidas guardadas', 'Código privado de recuperación', 'Nombre del director de juego', 'Volver a mi personaje', 'Reconectando'],
      'pt-BR': ['Seus jogos salvos', 'Código privado de recuperação', 'Nome do mestre do jogo', 'Voltar ao meu personagem', 'Reconectando'],
    };
    for (const language of ['es', 'pt-BR'] as const) {
      const html = [render('SavedGames', {}, language), render('RecoverSessionForm', { onRecovered: () => {} }, language), render('MasterRecovery', { room: view({ isMaster: true }), connected: true }, language), render('GameMasterStatus', { room: view({ gameMaster: { id: 'owner', name: 'Marshal Phil', connected: false, epoch: 1 } }) }, language)].join('');
      for (const phrase of expectations[language]) assert.ok(html.includes(phrase), `${language}: ${phrase}`);
      assert.doesNotMatch(html, /Your saved games|Private recovery code|Game master name|Return to my character/);
    }
  });
});
