import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { OnlineGameService } from '../online/service.js';
import { D1RoomRepository, MemoryRoomRepository, type D1DatabaseBinding } from '../online/repository.js';
import { executeRpc } from '../online/rpc.js';
import type { RoomView, Session } from '../shared/types.js';

function sqliteBinding(database: DatabaseSync): D1DatabaseBinding {
  return { prepare(sql) {
    let values: unknown[] = [];
    const statement = { bind(...next: unknown[]) { values = next; return statement; },
      async first<T>() { return database.prepare(sql).get(...values as never[]) as T | undefined ?? null; },
      async run() { return { meta: { changes: Number(database.prepare(sql).run(...values as never[]).changes) } }; } };
    return statement;
  } };
}

const context = (view: RoomView) => ({ gameId: view.gameId ?? null, phase: view.phase, round: view.round, actionEpoch: view.actionEpoch ?? 0 });

for (const backend of ['memory', 'sqlite'] as const) {
  function setup() {
    const database = backend === 'sqlite' ? new DatabaseSync(':memory:') : undefined;
    if (database) database.exec(readFileSync(new URL('../drizzle/0000_rooms.sql', import.meta.url), 'utf8'));
    const repository = database ? new D1RoomRepository(sqliteBinding(database)) : new MemoryRoomRepository();
    const service = new OnlineGameService({ repository, now: () => 100_000 });
    const execute = (event: string, payload: unknown, requestId?: string) => service.execute(event, payload, { requestId });
    const view = (session: Pick<Session, 'code'> & Partial<Session>) => execute('room:subscribe', { code: session.code, token: session.token }) as Promise<RoomView>;
    const command = (session: Session, action: unknown, observed?: unknown, requestId?: string) => execute('room:command', { code: session.code, token: session.token, action, ...(observed !== undefined ? { context: observed } : {}) }, requestId) as Promise<RoomView>;
    async function party() {
      const master = await execute('room:create', { rehearsal: true }) as Session;
      const players: Session[] = [];
      for (let index = 0; index < 2; index++) players.push(await execute('room:join', { code: master.code, name: `Guest ${index + 1}`, gender: 'any' }) as Session);
      return { master, players };
    }
    return { database, repository, service, execute, view, command, party };
  }

  test(`${backend}: two GM tabs advancing the same observed phase cannot skip the first act`, async t => {
    const f = setup(); t.after(() => f.database?.close());
    const { master } = await f.party();
    const roles = await f.command(master, { type: 'start' });
    const observed = context(roles);
    const results = await Promise.allSettled([
      f.command(master, { type: 'advance' }, observed, 'two-tabs-advance-a'),
      f.command(master, { type: 'advance' }, observed, 'two-tabs-advance-b'),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const act = await f.view(master);
    assert.equal(act.phase, 'investigation'); assert.equal(act.round, 1);
    const winningReceipt = results[0].status === 'fulfilled' ? 'two-tabs-advance-a' : 'two-tabs-advance-b';
    const secondAct = await f.command(master, { type: 'advance' }, context(act), 'advance-after-refresh');
    assert.equal(secondAct.round, 2);
    // A genuinely accepted lost response remains replayable after later transitions/restart.
    const restarted = new OnlineGameService({ repository: f.repository, now: () => 100_000 });
    const replay = await restarted.execute('room:command', { code: master.code, token: master.token, action: { type: 'advance' }, context: observed }, { requestId: winningReceipt }) as RoomView;
    assert.equal(replay.round, 2);
    assert.equal((await f.view(master)).round, 2);
  });

  test(`${backend}: a delayed suspicion from the prior act cannot change the current act`, async t => {
    const f = setup(); t.after(() => f.database?.close());
    const { master, players } = await f.party();
    await f.command(master, { type: 'start' });
    const firstAct = await f.command(master, { type: 'advance' });
    await f.command(master, { type: 'advance' });
    await assert.rejects(f.command(players[0], { type: 'suspect', playerId: players[1].playerId }, context(firstAct)), /moved on/i);
    const current = await f.view(players[0]);
    assert.equal(current.round, 2); assert.equal(current.me?.suspicionId, null);
    assert.deepEqual(Object.values(current.suspicions!), [0, 0]);
    const accepted = await f.command(players[0], { type: 'suspect', playerId: players[1].playerId }, context(current));
    assert.equal(accepted.me?.suspicionId, players[1].playerId);
  });

  test(`${backend}: a delayed ready action cannot acknowledge a newly dealt character`, async t => {
    const f = setup(); t.after(() => f.database?.close());
    const { master, players } = await f.party();
    const oldRoles = await f.command(master, { type: 'start' });
    await f.command(master, { type: 'reset' });
    const newRoles = await f.command(master, { type: 'start' });
    assert.notEqual(newRoles.gameId, oldRoles.gameId);
    await assert.rejects(f.command(players[0], { type: 'ready', ready: true }, context(oldRoles)), /moved on/i);
    assert.equal((await f.view(players[0])).me?.ready, false);
    await f.command(players[0], { type: 'ready', ready: true }, context(newRoles));
    assert.equal((await f.view(players[0])).me?.ready, true);
  });

  test(`${backend}: a delayed final accusation cannot seal a vote in the next mystery`, async t => {
    const f = setup(); t.after(() => f.database?.close());
    const { master, players } = await f.party();
    await f.command(master, { type: 'settings', settings: { rounds: 1 } });
    async function openVoting() {
      await f.command(master, { type: 'start' });
      await f.command(master, { type: 'advance' });
      return f.command(master, { type: 'advance' });
    }
    const oldVoting = await openVoting();
    await f.command(master, { type: 'reset' });
    const newVoting = await openVoting();
    await assert.rejects(f.command(players[0], { type: 'vote', playerId: players[1].playerId }, context(oldVoting)), /moved on/i);
    const privateView = await f.view(players[0]);
    assert.equal(privateView.me?.votedFor, null); assert.equal(privateView.votesCount, 0); assert.equal(privateView.result, undefined);
    const accepted = await f.command(players[0], { type: 'vote', playerId: players[1].playerId }, context(newVoting));
    assert.equal(accepted.votesCount, 1); assert.equal(accepted.me?.votedFor, players[1].playerId);
    const publicView = await f.view({ code: master.code });
    assert.equal(publicView.me, undefined); assert.equal(publicView.result, undefined);
    assert.equal(publicView.votesCount, 1); assert.equal(JSON.stringify(publicView).includes('votedFor'), false);
  });

  test(`${backend}: initial-lobby commands cannot start, remove seats or change settings after a reset`, async t => {
    const f = setup(); t.after(() => f.database?.close());
    const { master, players } = await f.party();
    const initialLobby = await f.view(master);
    await f.command(master, { type: 'start' });
    const newLobby = await f.command(master, { type: 'reset' });
    assert.equal(initialLobby.gameId, undefined); assert.equal(newLobby.gameId, undefined);
    const oldContext = { gameId: initialLobby.gameId ?? null, phase: initialLobby.phase, round: initialLobby.round };
    for (const action of [{ type: 'start' }, { type: 'kick', playerId: players[0].playerId }, { type: 'settings', settings: { rounds: 1 } }]) {
      await assert.rejects(f.command(master, action, oldContext), /moved on/i);
      const unchanged = await f.view(master);
      assert.equal(unchanged.phase, 'lobby'); assert.equal(unchanged.players.length, 2);
      assert.equal(unchanged.settings.rounds, 3); assert.equal(unchanged.actionEpoch, 1);
    }
    assert.equal(initialLobby.actionEpoch, 0); assert.equal(newLobby.actionEpoch, 1);
    assert.equal((await f.command(master, { type: 'start' }, context(newLobby))).phase, 'roles');
  });

  test(`${backend}: repeated lobby resets retire old observations without repeating accepted receipts`, async t => {
    const f = setup(); t.after(() => f.database?.close());
    const { master, players } = await f.party();
    const first = await f.view(master);
    const second = await f.command(master, { type: 'reset' }, context(first), 'reset-first-lobby');
    assert.equal(second.actionEpoch, 1); assert.equal(second.gameId, undefined);
    await assert.rejects(f.command(master, { type: 'reset' }, context(first), 'stale-first-lobby'), /moved on/i);
    assert.equal((await f.command(master, { type: 'reset' }, context(first), 'reset-first-lobby')).actionEpoch, 1);
    const third = await f.command(master, { type: 'reset' }, context(second), 'reset-next-lobby');
    assert.equal(third.actionEpoch, 2);
    assert.equal((await f.command(master, { type: 'reset' }, context(first), 'reset-first-lobby')).actionEpoch, 2);
    await assert.rejects(f.command(master, { type: 'kick', playerId: players[0].playerId }, context(second)), /moved on/i);
    const accepted = await f.command(master, { type: 'kick', playerId: players[0].playerId }, context(third));
    assert.equal(accepted.players.length, 1); assert.equal(accepted.actionEpoch, 2);
  });

  test(`${backend}: legacy rooms default to the first action epoch and persist it across reset and restart`, async t => {
    const f = setup(); t.after(() => f.database?.close());
    const { master } = await f.party();
    const stored = (await f.repository.get(master.code))!;
    const envelope = JSON.parse(stored.state); delete envelope.room.actionEpoch;
    assert.equal(await f.repository.compareAndSwap({ ...stored, state: JSON.stringify(envelope) }, stored.revision), true);
    const legacy = await f.view(master);
    assert.equal(legacy.actionEpoch, 0);
    // Missing epoch remains compatible with initial-generation scoped callers.
    const reset = await f.command(master, { type: 'reset' }, { gameId: null, phase: 'lobby', round: 0 });
    assert.equal(reset.actionEpoch, 1);
    const restarted = new OnlineGameService({ repository: f.repository, now: () => 100_000 });
    const restored = await restarted.execute('room:subscribe', { code: master.code, token: master.token }) as RoomView;
    assert.equal(restored.actionEpoch, 1);
    await assert.rejects(restarted.execute('room:command', { code: master.code, token: master.token, action: { type: 'start' }, context: context(legacy) }), /moved on/i);
    assert.equal((await f.view(master)).phase, 'lobby');
  });

  test(`${backend}: malformed action context is rejected atomically while older clients remain compatible`, async t => {
    const f = setup(); t.after(() => f.database?.close());
    const { master } = await f.party();
    const initial = await f.view(master);
    const malformed = [null, [], 'lobby', {}, { phase: 'lobby', round: 0 },
      { gameId: 12, phase: 'lobby', round: 0 }, { gameId: '', phase: 'lobby', round: 0 },
      { gameId: null, phase: 'future', round: 0 }, { gameId: null, phase: 'lobby', round: -1 },
      { gameId: null, phase: 'lobby', round: 1.5 }, { gameId: null, phase: 'lobby', round: 6 },
      { gameId: null, phase: 'lobby', round: 0, ignored: true },
      ...[null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0'].map(actionEpoch => ({ gameId: null, phase: 'lobby', round: 0, actionEpoch }))];
    for (const observed of malformed) {
      await assert.rejects(f.command(master, { type: 'lock', locked: true }, observed), /Invalid game action context/i);
      assert.equal((await f.view(master)).isLocked, false);
    }
    const beforeAuth = await f.command({ ...master, token: 'revoked-token' }, { type: 'lock', locked: true }, null).catch(cause => cause as Error);
    assert.match((beforeAuth as unknown as Error).message, /token/i);
    const accepted = await f.command(master, { type: 'lock', locked: true }, context(initial));
    assert.equal(accepted.isLocked, true);
    assert.equal((await f.command(master, { type: 'lock', locked: false })).isLocked, false);
    assert.equal((await f.command(master, { type: 'start' })).phase, 'roles');
    assert.equal((await f.command(master, { type: 'advance' })).round, 1);
  });
}

test('stale action errors are localized without revoking the current phone session', async () => {
  const service = new OnlineGameService({ repository: new MemoryRoomRepository(), now: () => 100_000 });
  const master = await service.execute('room:create', { rehearsal: true }) as Session;
  const player = await service.execute('room:join', { code: master.code, name: 'Guest', gender: 'any' }) as Session;
  const observed = { gameId: null, phase: 'lobby', round: 0 };
  await service.execute('room:command', { code: master.code, token: master.token, action: { type: 'start' } });
  for (const [language, phrase] of [['en', 'moved on'], ['es', 'ha avanzado'], ['pt-BR', 'avançou']] as const) {
    const rejected = await executeRpc(service, { event: 'room:command', payload: { code: player.code, token: player.token, action: { type: 'ready', ready: true }, context: observed, language } });
    assert.equal(rejected.ok, false); assert.equal(rejected.errorCode, 'INVALID_REQUEST');
    assert.ok(rejected.error?.includes(phrase));
  }
  const current = await service.execute('room:subscribe', { code: player.code, token: player.token }) as RoomView;
  assert.equal(current.me?.playerId, player.playerId); assert.equal(current.me?.ready, false);
});
