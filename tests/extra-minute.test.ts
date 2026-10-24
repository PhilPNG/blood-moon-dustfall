import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, type RoomSnapshot } from '../server/engine.js';
import { OnlineGameService } from '../online/service.js';
import { MemoryRoomRepository } from '../online/repository.js';
import { executeRpc } from '../online/rpc.js';
import { SAFE_ERROR_MESSAGE } from '../server/localization.js';
import type { Action, Reply, RoomView, Session } from '../shared/types.js';

const extension: Action = { type: 'extend-time' };

function party(roundSeconds = 300, rounds = 2) {
  let now = 90_000;
  const engine = new GameEngine({ now: () => now });
  const master = engine.create();
  const players = Array.from({ length: 4 }, (_, index) => engine.join({ code: master.code, name: `Guest ${index + 1}`, gender: 'any' }));
  const run = (action: unknown) => engine.command(master.code, master.token, action);
  const view = () => engine.view(master.code);
  run({ type: 'settings', settings: { roundSeconds, rounds } });
  const investigate = () => { run({ type: 'start' }); run({ type: 'advance' }); now = 100_000; };
  return { engine, master, players, run, view, investigate, setNow(value: number) { now = value; } };
}

function withoutTimer(snapshot: RoomSnapshot) {
  const { startsAt: _startsAt, endsAt: _endsAt, remainingMs: _remainingMs, ...state } = snapshot;
  return state;
}

test('a running extension adds exactly one minute to the actual fractional time left', () => {
  const { engine, master, run, view, investigate, setNow } = party();
  investigate();
  setNow(145_678);
  assert.equal(view().timer.remaining, 255);
  run(extension);
  assert.deepEqual(view().timer, { endsAt: 460_000, remaining: 315, isPaused: false });
  assert.equal(engine.exportRoom(master.code).remainingMs, 314_322);
  setNow(146_000);
  assert.equal(view().timer.remaining, 314);
});

test('a paused extension preserves the pause and resumes with the extended stored milliseconds', () => {
  const { engine, master, run, view, investigate, setNow } = party();
  investigate();
  setNow(145_678);
  run({ type: 'pause' });
  const paused = engine.exportRoom(master.code);
  setNow(200_000);
  run(extension);
  assert.equal(engine.exportRoom(master.code).remainingMs, 314_322);
  assert.deepEqual(view().timer, { endsAt: null, remaining: 315, isPaused: true });
  assert.deepEqual(withoutTimer(engine.exportRoom(master.code)), withoutTimer(paused));
  setNow(250_000);
  assert.equal(view().timer.remaining, 315);
  run({ type: 'resume' });
  assert.deepEqual(view().timer, { endsAt: 564_322, remaining: 315, isPaused: false });
});

for (const paused of [false, true]) {
  test(`an expired ${paused ? 'paused' : 'running'} investigation receives a full fresh minute`, () => {
    const { run, view, investigate, setNow } = party(60);
    investigate();
    setNow(180_000);
    if (paused) run({ type: 'pause' });
    assert.equal(view().timer.remaining, 0);
    run(extension);
    assert.deepEqual(view().timer, { endsAt: paused ? null : 240_000, remaining: 60, isPaused: paused });
    assert.equal(view().phase, 'investigation');
    assert.equal(view().round, 1);
  });
}

for (const paused of [false, true]) {
  test(`extensions clamp fractional ${paused ? 'paused' : 'running'} remainders to ten minutes and reject at the cap atomically`, () => {
    const { engine, master, run, view, investigate, setNow } = party(600);
    investigate();
    setNow(100_001);
    if (paused) run({ type: 'pause' });
    // The display rounds 599,999 ms up to 600 seconds, but the server must still allow the final millisecond.
    assert.equal(view().timer.remaining, 600);
    run(extension);
    assert.equal(engine.exportRoom(master.code).remainingMs, 600_000);
    assert.deepEqual(view().timer, { endsAt: paused ? null : 700_001, remaining: 600, isPaused: paused });
    const atCap = engine.exportRoom(master.code);
    assert.throws(() => run(extension), /10 minutes|ten minutes|600/i);
    assert.deepEqual(engine.exportRoom(master.code), atCap);
  });
}

test('the extra minute is master-only, including while paused, and never accepts display authority', () => {
  const { engine, master, players, run, investigate } = party();
  investigate();
  const display = engine.claimDisplay(master.code, 'extra-minute-tv');
  for (const paused of [false, true]) {
    if (paused) run({ type: 'pause' });
    const before = engine.exportRoom(master.code);
    assert.throws(() => engine.command(master.code, undefined, extension), /token/i);
    assert.throws(() => engine.command(master.code, players[0].token, extension), /master/i);
    assert.throws(() => engine.command(master.code, display.token, extension), /token/i);
    assert.throws(() => engine.command(master.code, 'forged', extension), /token/i);
    assert.deepEqual(engine.exportRoom(master.code), before);
  }
});

test('the extra minute rejects every non-investigation phase without changing any state', () => {
  const { engine, master, run, view } = party(60, 1);
  for (const phase of ['lobby', 'roles', 'voting', 'results']) {
    assert.equal(view().phase, phase);
    const before = engine.exportRoom(master.code);
    assert.throws(() => run(extension), /only available during investigation/i);
    assert.deepEqual(engine.exportRoom(master.code), before);
    if (phase === 'lobby') run({ type: 'start' });
    else if (phase === 'roles') { run({ type: 'advance' }); run({ type: 'advance' }); }
    else if (phase === 'voting') run({ type: 'advance' });
  }
});

test('extensions preserve answers, scores, evidence, presentation, captions and the live media clock', () => {
  const { engine, master, players, run, view, investigate, setNow } = party();
  investigate();
  const player = players[0];
  const privateView = engine.view(master.code, player.token);
  const answer = privateView.act!.question.options[0].id;
  engine.command(master.code, player.token, { type: 'answer', optionId: answer });
  engine.command(master.code, player.token, { type: 'search', locationId: privateView.act!.locations[0].id });
  engine.command(master.code, player.token, { type: 'publish-clue', clueId: privateView.me!.clues[0].id });
  run({ type: 'captions', language: 'pt-BR' });
  run({ type: 'pause' });
  run({ type: 'resume' });
  run({ type: 'presentation', control: 'replay' });
  setNow(110_000); // Replay's audience cue finishes before native playback can begin.
  const display = engine.claimDisplay(master.code, 'extra-minute-clock');
  engine.reportPlayback(master.code, display.displayId, display.token, {
    eventKey: `${view().gameId}:investigation:1:presentation:1:clock:2`, clipId: 'act-1', kind: 'film', position: 0.5, playing: true,
  }, 1);
  const before = engine.exportRoom(master.code);
  run(extension);
  assert.deepEqual(withoutTimer(engine.exportRoom(master.code)), withoutTimer(before));
  assert.equal(engine.view(master.code, player.token).me?.answeredOptionId, answer);
  assert.throws(() => engine.command(master.code, player.token, { type: 'answer', optionId: answer }), /already final/i);
  const publicView = view();
  assert.equal(publicView.me, undefined);
  assert.equal(publicView.isMaster, false);
  assert.equal('correctOptionId' in publicView.act!.question, false);
  for (const session of [master, ...players]) assert.equal(JSON.stringify(publicView).includes(session.token), false);
  assert.equal(JSON.stringify(publicView).includes('alignment'), false);
  assert.equal(JSON.stringify(publicView).includes('votedFor'), false);
});

test('the next act starts with the configured duration after the current investigation was extended', () => {
  const { run, view, investigate, setNow } = party(90);
  investigate();
  run(extension);
  assert.equal(view().timer.remaining, 150);
  assert.equal(view().settings.roundSeconds, 90);
  setNow(120_000);
  run({ type: 'advance' });
  assert.equal(view().round, 2);
  assert.deepEqual(view().timer, { startsAt: 130_000, endsAt: 220_000, remaining: 90, isPaused: false });
});

for (const paused of [false, true]) {
  test(`an extended ${paused ? 'paused' : 'running'} clock survives JSON snapshots without stale presence`, () => {
    const { engine, master, players, run, view, investigate, setNow } = party();
    investigate();
    engine.connect(master.code, players[0].token, 'old-phone');
    setNow(125_500);
    if (paused) run({ type: 'pause' });
    run(extension);
    const snapshot = JSON.parse(JSON.stringify(engine.exportRoom(master.code)));
    const restored = new GameEngine({ now: () => 145_500 });
    restored.restoreRoom(snapshot);
    assert.deepEqual(restored.view(master.code).timer, {
      endsAt: paused ? null : 460_000, remaining: paused ? 335 : 315, isPaused: paused,
    });
    assert.equal(restored.view(master.code, players[0].token).me?.playerId, players[0].playerId);
    assert.equal(restored.view(master.code).players[0].connected, false);
    assert.equal(restored.view(master.code).round, view().round);
  });
}

test('RPC retries add once across concurrent calls, language changes, service restart and later acts', async () => {
  let now = 90_000;
  const repository = new MemoryRoomRepository();
  let service = new OnlineGameService({ repository, now: () => now });
  const success = async <T>(event: string, payload: Record<string, unknown>, requestId?: string): Promise<T> => {
    const reply = await executeRpc(service, { event, payload, requestId });
    assert.equal(reply.ok, true, reply.error ?? 'Expected successful RPC');
    return reply.data as T;
  };
  const master = await success<Session>('room:create', {});
  const players: Session[] = [];
  for (let index = 0; index < 4; index++) players.push(await success<Session>('room:join', { code: master.code, name: `RPC guest ${index}`, gender: 'any' }));
  const command = (action: unknown, requestId?: string, language = 'en') => success<RoomView>('room:command', { ...master, action, language }, requestId);
  await command({ type: 'start' });
  await command({ type: 'advance' });
  now = 100_000;
  now = 145_678;
  const [first, duplicate] = await Promise.all([command(extension, 'extend-once-001'), command(extension, 'extend-once-001')]);
  assert.equal(first.timer.endsAt, 460_000);
  assert.deepEqual(duplicate.timer, first.timer);
  assert.equal(duplicate.revision, first.revision);
  service = new OnlineGameService({ repository, now: () => now });
  const retried = await command(extension, 'extend-once-001', 'es');
  assert.deepEqual(retried.timer, first.timer);
  assert.equal(retried.revision, first.revision);
  const stored = await repository.get(master.code);
  const persisted = JSON.parse(stored!.state).room;
  assert.equal(persisted.endsAt, 460_000);
  assert.equal(persisted.remainingMs, 314_322);
  const publicView = await success<RoomView>('room:subscribe', { code: master.code });
  const phone = await success<RoomView>('room:subscribe', { ...players[0] });
  assert.deepEqual(publicView.timer, first.timer);
  assert.deepEqual(phone.timer, first.timer);
  assert.equal(publicView.me, undefined);
  for (const session of [master, ...players]) assert.equal(JSON.stringify(publicView).includes(session.token), false);
  const collision = await executeRpc(service, { event: 'room:command', payload: { ...master, action: { type: 'pause' } }, requestId: 'extend-once-001' });
  assert.equal(collision.ok, false);
  assert.match(collision.error!, /request ID was reused/i);
  now = 160_000;
  await command({ type: 'advance' });
  const lateRetry = await command(extension, 'extend-once-001', 'pt-BR');
  assert.equal(lateRetry.round, 2);
  assert.equal(lateRetry.timer.endsAt, 470_000);
  assert.equal(lateRetry.timer.remaining, 300);
  await command({ type: 'pause' });
  const paused = await command(extension, 'extend-paused-001');
  service = new OnlineGameService({ repository, now: () => now });
  const pausedRetry = await command(extension, 'extend-paused-001', 'es');
  assert.deepEqual(pausedRetry.timer, { endsAt: null, remaining: 360, isPaused: true });
  assert.equal(pausedRetry.revision, paused.revision);
});

test('RPC cap and authority failures are localized, safe and never persist a timer mutation', async () => {
  const repository = new MemoryRoomRepository();
  const service = new OnlineGameService({ repository, now: () => 100_000 });
  const success = async <T>(event: string, payload: Record<string, unknown>): Promise<T> => {
    const reply = await executeRpc(service, { event, payload });
    assert.equal(reply.ok, true, reply.error ?? 'Expected successful RPC'); return reply.data as T;
  };
  const master = await success<Session>('room:create', {});
  const players: Session[] = [];
  for (let index = 0; index < 4; index++) players.push(await success<Session>('room:join', { code: master.code, name: `Cap guest ${index}`, gender: 'any' }));
  const command = (action: unknown) => success<RoomView>('room:command', { ...master, action });
  await command({ type: 'settings', settings: { roundSeconds: 600 } });
  await command({ type: 'start' });
  await command({ type: 'advance' });
  const before = await repository.get(master.code);
  const errors: Reply<unknown>[] = [];
  for (const language of ['en', 'es', 'pt-BR']) {
    const reply = await executeRpc(service, { event: 'room:command', payload: { ...master, action: extension, language } });
    assert.equal(reply.ok, false);
    assert.equal(reply.errorCode, 'INVALID_REQUEST');
    assert.equal(reply.data, undefined);
    assert.ok(reply.error && reply.error !== SAFE_ERROR_MESSAGE);
    assert.match(reply.error, /10/);
    for (const session of [master, ...players]) assert.equal(JSON.stringify(reply).includes(session.token), false);
    errors.push(reply);
  }
  assert.equal(new Set(errors.map(reply => reply.error)).size, 3);
  assert.equal((await repository.get(master.code))!.state, before!.state);
  assert.equal((await repository.get(master.code))!.revision, before!.revision);
  const unauthorized = await executeRpc(service, { event: 'room:command', payload: { ...players[0], action: extension, language: 'es' } });
  assert.equal(unauthorized.ok, false);
  assert.match(unauthorized.error!, /director de juego/i);
  const anonymous = await executeRpc(service, { event: 'room:command', payload: { code: master.code, action: extension, language: 'pt-BR' } });
  assert.equal(anonymous.errorCode, 'SESSION_INVALID');
  assert.equal((await repository.get(master.code))!.state, before!.state);
});
