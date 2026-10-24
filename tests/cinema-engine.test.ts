import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, type RoomSnapshot } from '../server/engine.js';
import { OnlineGameService } from '../online/service.js';
import { MemoryRoomRepository } from '../online/repository.js';
import type { RoomView, Session } from '../shared/types.js';

function party() {
  const engine = new GameEngine({ now: () => 100_000 });
  const master = engine.create();
  const players = Array.from({ length: 4 }, (_, index) => engine.join({ code: master.code, name: `Player ${index + 1}`, gender: 'any' }));
  const run = (action: unknown) => engine.command(master.code, master.token, action);
  const view = () => engine.view(master.code);
  return { engine, master, players, run, view };
}

function gameplay(snapshot: RoomSnapshot) {
  const { presentation: _presentation, captionLanguage: _captionLanguage, captionSerial: _captionSerial,
    attention: _attention, attentionSerial: _attentionSerial, attentionClaims: _attentionClaims,
    attentionClueBaseline: _attentionClueBaseline, ...state } = snapshot;
  return state;
}

test('each deal gets a new public game identity while reset retains the caption preference', () => {
  const { run, view, master, players } = party();
  assert.equal(view().captionLanguage, 'off');
  assert.equal(view().gameId, undefined);
  run({ type: 'captions', language: 'pt-BR' });
  run({ type: 'start' });
  const firstGame = view().gameId;
  assert.equal(typeof firstGame, 'string');
  assert.ok(firstGame && firstGame.length >= 24);
  for (const session of [master, ...players]) assert.notEqual(firstGame, session.token);
  run({ type: 'presentation', control: 'skip' });
  run({ type: 'reset' });
  assert.equal(view().gameId, undefined);
  assert.equal(view().presentation, undefined);
  assert.equal(view().captionLanguage, 'pt-BR');
  run({ type: 'start' });
  assert.notEqual(view().gameId, firstGame);
  assert.equal(view().captionLanguage, 'pt-BR');
  assert.equal(view().presentation, undefined);
});

test('cinema and caption controls require the game master and validate their choices atomically', () => {
  const { engine, master, players, run } = party();
  for (const action of [{ type: 'presentation', control: 'skip' }, { type: 'captions', language: 'en' }]) {
    assert.throws(() => engine.command(master.code, undefined, action), /token/i);
    assert.throws(() => engine.command(master.code, players[0].token, action), /master/i);
  }
  const lobby = engine.exportRoom(master.code);
  assert.throws(() => run({ type: 'presentation', control: 'replay' }), /started|lobby|game/i);
  assert.deepEqual(engine.exportRoom(master.code), lobby);
  run({ type: 'start' });
  const started = engine.exportRoom(master.code);
  for (const control of [undefined, null, '', 'play', 'SKIP', {}, 1]) {
    assert.throws(() => run({ type: 'presentation', control }), /control|presentation|skip|replay/i);
    assert.deepEqual(engine.exportRoom(master.code), started);
  }
  for (const language of [undefined, null, '', 'pt', 'ptBR', 'EN', {}, 1]) {
    assert.throws(() => run({ type: 'captions', language }), /caption|language/i);
    assert.deepEqual(engine.exportRoom(master.code), started);
  }
});

test('repeating a GM caption selection remains observable and survives reset and JSON restore', () => {
  const { engine, master, run, view } = party();
  run({ type: 'captions', language: 'off' });
  assert.equal(view().captionSerial, 1);
  run({ type: 'captions', language: 'off' });
  assert.equal(view().captionSerial, 2);
  run({ type: 'captions', language: 'en' });
  assert.equal(view().captionSerial, 3);
  run({ type: 'reset' });
  const restored = new GameEngine({ now: () => 100_000 });
  restored.restoreRoom(JSON.parse(JSON.stringify(engine.exportRoom(master.code))));
  assert.equal(restored.view(master.code).captionLanguage, 'en');
  assert.equal(restored.view(master.code).captionSerial, 3);
  restored.command(master.code, master.token, { type: 'captions', language: 'en' });
  assert.equal(restored.view(master.code).captionSerial, 4);
});

test('repeat cinema controls create distinct current-event serials without changing gameplay', () => {
  const { engine, master, players, run, view } = party();
  run({ type: 'start' });
  engine.command(master.code, players[0].token, { type: 'ready', ready: true });
  const roles = engine.exportRoom(master.code);
  const gameId = view().gameId;
  run({ type: 'presentation', control: 'skip', eventKey: 'forged:event' });
  assert.deepEqual(view().presentation, { serial: 1, eventKey: `${gameId}:roles:0`, control: 'skip' });
  assert.deepEqual(gameplay(engine.exportRoom(master.code)), gameplay(roles));
  run({ type: 'presentation', control: 'skip' });
  assert.equal(view().presentation?.serial, 2);
  run({ type: 'presentation', control: 'replay' });
  assert.deepEqual(view().presentation, { serial: 3, eventKey: `${gameId}:roles:0`, control: 'replay' });
  assert.deepEqual(gameplay(engine.exportRoom(master.code)), gameplay(roles));
  for (let poll = 0; poll < 3; poll++) assert.deepEqual(view().presentation, { serial: 3, eventKey: `${gameId}:roles:0`, control: 'replay' });
  run({ type: 'advance' });
  const investigation = engine.exportRoom(master.code);
  run({ type: 'presentation', control: 'replay' });
  assert.deepEqual(view().presentation, { serial: 4, eventKey: `${gameId}:investigation:1`, control: 'replay' });
  assert.deepEqual(gameplay(engine.exportRoom(master.code)), gameplay(investigation));
});

test('cinema controls work while paused and in voting and results without changing clocks or votes', () => {
  const { engine, master, players, run, view } = party();
  run({ type: 'settings', settings: { rounds: 1 } });
  run({ type: 'start' });
  run({ type: 'advance' });
  run({ type: 'pause' });
  const paused = engine.exportRoom(master.code);
  run({ type: 'presentation', control: 'skip' });
  run({ type: 'captions', language: 'en' });
  assert.equal(view().timer.isPaused, true);
  assert.deepEqual(gameplay(engine.exportRoom(master.code)), gameplay(paused));
  run({ type: 'resume' });
  assert.equal(view().timer.isPaused, false);
  run({ type: 'advance' });
  engine.command(master.code, players[0].token, { type: 'vote', playerId: players[1].playerId });
  for (const phase of ['voting', 'results']) {
    assert.equal(view().phase, phase);
    const before = engine.exportRoom(master.code);
    run({ type: 'presentation', control: 'replay' });
    assert.equal(view().presentation?.eventKey, `${view().gameId}:${phase}:1`);
    assert.deepEqual(gameplay(engine.exportRoom(master.code)), gameplay(before));
    if (phase === 'voting') run({ type: 'advance' });
  }
});

test('only the GM can pause and resume results without changing the verdict, votes or awards', () => {
  const { engine, master, players, run, view } = party();
  run({ type: 'settings', settings: { rounds: 1 } });
  run({ type: 'start' });
  run({ type: 'advance' });
  run({ type: 'advance' });
  const culprit = players.find(player => engine.view(master.code, player.token).me?.role?.alignment === 'culprit')!;
  for (const player of players) {
    const target = player.playerId === culprit.playerId ? players.find(other => other.playerId !== culprit.playerId)! : culprit;
    engine.command(master.code, player.token, { type: 'vote', playerId: target.playerId });
  }
  run({ type: 'advance' });
  const result = engine.exportRoom(master.code);
  assert.equal(result.phase, 'results');
  assert.equal(result.result?.caught, true);
  assert.equal(result.result?.tallies[culprit.playerId!], 3);
  assert.ok(result.result?.scores?.some(score => score.score === 200));
  assert.throws(() => engine.command(master.code, undefined, { type: 'pause' }), /token/i);
  assert.throws(() => engine.command(master.code, players[0].token, { type: 'pause' }), /master/i);
  assert.deepEqual(engine.exportRoom(master.code), result);
  run({ type: 'pause' });
  const pausedResult = { ...result, attention: { ...result.attention!, endsAt: null }, isPaused: true, playbackEpoch: 1 };
  assert.deepEqual(engine.exportRoom(master.code), pausedResult);
  assert.equal(view().timer.isPaused, true);
  assert.throws(() => engine.command(master.code, players[0].token, { type: 'resume' }), /master/i);
  assert.throws(() => run({ type: 'advance' }), /paused/i);
  assert.deepEqual(engine.exportRoom(master.code), pausedResult);
  run({ type: 'resume' });
  assert.deepEqual(engine.exportRoom(master.code), { ...result, playbackEpoch: 2 });
  assert.deepEqual(view().timer, { endsAt: null, remaining: 0, isPaused: false });
});

test('cinema state survives JSON snapshots and public views are copied without bearer credentials', () => {
  const { engine, master, players, run, view } = party();
  run({ type: 'start' });
  run({ type: 'captions', language: 'pt-BR' });
  run({ type: 'presentation', control: 'replay' });
  const snapshot = JSON.parse(JSON.stringify(engine.exportRoom(master.code))) as RoomSnapshot;
  const restored = new GameEngine({ now: () => 100_000 });
  restored.restoreRoom(snapshot);
  assert.deepEqual(restored.view(master.code), view());
  snapshot.presentation!.serial = 99;
  const publicView = restored.view(master.code);
  publicView.presentation!.control = 'skip';
  assert.equal(restored.view(master.code).presentation?.serial, 1);
  assert.equal(restored.view(master.code).presentation?.control, 'replay');
  const publicJson = JSON.stringify(restored.view(master.code));
  for (const session of [master, ...players]) assert.equal(publicJson.includes(session.token), false);
  assert.equal(publicJson.includes('alignment'), false);
  assert.equal(publicJson.includes('masterToken'), false);
  restored.command(master.code, master.token, { type: 'presentation', control: 'skip' });
  assert.equal(restored.view(master.code).presentation?.serial, 2);
});

test('older modern-cast snapshots have a stable cinema event fallback and default captions off', () => {
  const { engine, master, run } = party();
  run({ type: 'start' });
  const snapshot = engine.exportRoom(master.code);
  delete snapshot.gameId;
  delete snapshot.captionLanguage;
  const restored = new GameEngine({ now: () => 100_000 });
  restored.restoreRoom(snapshot);
  assert.equal(restored.view(master.code).captionLanguage, 'off');
  restored.command(master.code, master.token, { type: 'presentation', control: 'skip' });
  const eventKey = `legacy-${master.code}:roles:0`;
  assert.equal(restored.view(master.code).presentation?.eventKey, eventKey);
  const reloaded = new GameEngine({ now: () => 100_000 });
  reloaded.restoreRoom(JSON.parse(JSON.stringify(restored.exportRoom(master.code))));
  reloaded.command(master.code, master.token, { type: 'presentation', control: 'replay' });
  assert.deepEqual(reloaded.view(master.code).presentation, { serial: 2, eventKey, control: 'replay' });
});

test('obsolete-cast migration also clears cinema events while preserving seats, notice and caption preference', () => {
  const { engine, master, run } = party();
  run({ type: 'start' });
  run({ type: 'captions', language: 'pt-BR' });
  run({ type: 'presentation', control: 'replay' });
  const old = engine.exportRoom(master.code);
  old.players[0].role!.name = 'The Entertainer';
  const restored = new GameEngine({ now: () => 100_000 });
  restored.restoreRoom(old);
  const migrated = restored.view(master.code);
  assert.equal(migrated.phase, 'lobby');
  assert.equal(migrated.players.length, 4);
  assert.equal(migrated.gameId, undefined);
  assert.equal(migrated.presentation, undefined);
  assert.equal(migrated.captionLanguage, 'pt-BR');
  assert.match(migrated.notice!, /upgraded/);
  const reloaded = new GameEngine({ now: () => 100_000 });
  reloaded.restoreRoom(restored.exportRoom(master.code));
  assert.equal(reloaded.view(master.code).notice, migrated.notice);
});

test('online cinema request receipts prevent a lost reply from repeating a control after restart or phase change', async () => {
  const repository = new MemoryRoomRepository();
  let service = new OnlineGameService({ repository, now: () => 100_000 });
  const master = await service.execute('room:create', {}) as Session;
  for (let index = 0; index < 4; index++) await service.execute('room:join', { code: master.code, name: `Player ${index + 1}`, gender: 'any' });
  const command = (action: unknown, requestId?: string) => service.execute('room:command', { ...master, action }, { requestId }) as Promise<RoomView>;
  await command({ type: 'start' });
  const action = { type: 'presentation', control: 'replay' };
  const first = await command(action, 'cinema-1');
  assert.equal(first.presentation?.serial, 1);
  service = new OnlineGameService({ repository, now: () => 100_000 });
  const retried = await command(action, 'cinema-1');
  assert.deepEqual(retried.presentation, first.presentation);
  assert.equal(retried.revision, first.revision);
  const second = await command(action, 'cinema-2');
  assert.equal(second.presentation?.serial, 2);
  await command({ type: 'advance' });
  const lateRetry = await command(action, 'cinema-1');
  assert.equal(lateRetry.phase, 'investigation');
  assert.deepEqual(lateRetry.presentation, second.presentation);
  const [once, twice] = await Promise.all([command(action, 'cinema-3'), command(action, 'cinema-3')]);
  assert.equal(once.presentation?.serial, 3);
  assert.equal(twice.presentation?.serial, 3);
  assert.equal(once.presentation?.eventKey, `${once.gameId}:investigation:1`);
  await assert.rejects(command({ type: 'presentation', control: 'skip' }, 'cinema-3'), /request|reused/i);
});
