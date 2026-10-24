import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { GameEngine } from '../server/engine.js';
import { OnlineGameService } from '../online/service.js';
import { D1RoomRepository, MemoryRoomRepository, type D1DatabaseBinding } from '../online/repository.js';
import type { RoomView, Session } from '../shared/types.js';

function sqliteBinding(database: DatabaseSync): D1DatabaseBinding {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const prepared = {
        bind(...next: unknown[]) { values = next; return prepared; },
        async first<T>() { return database.prepare(sql).get(...values as never[]) as T | undefined ?? null; },
        async run() { const result = database.prepare(sql).run(...values as never[]); return { meta: { changes: Number(result.changes) } }; },
      };
      return prepared;
    },
  };
}

test('engine snapshots restore private roles and clocks without stale connections', () => {
  const engine = new GameEngine();
  const master = engine.create();
  const player = engine.join({ code: master.code, name: 'Alex', gender: 'any' });
  engine.connect(master.code, player.token, 'old-connection');
  const snapshot = JSON.parse(JSON.stringify(engine.exportRoom(master.code)));
  const restored = new GameEngine();
  restored.restoreRoom(snapshot);
  assert.equal(restored.view(master.code, player.token).me?.playerId, player.playerId);
  assert.equal(restored.view(master.code).players[0].connected, false);
  assert.equal(restored.view(master.code, master.token).isMaster, true);
});

for (const backend of ['memory', 'sqlite'] as const) {
  function setup() {
    let now = 100_000;
    const database = backend === 'sqlite' ? new DatabaseSync(':memory:') : undefined;
    if (database) database.exec(readFileSync(new URL('../drizzle/0000_rooms.sql', import.meta.url), 'utf8'));
    const repository = database ? new D1RoomRepository(sqliteBinding(database)) : new MemoryRoomRepository();
    const service = new OnlineGameService({ repository, now: () => now });
    const execute = (event: string, payload: unknown, requestId?: string) => service.execute(event, payload, { requestId });
    const view = (code: string, token?: string) => execute('room:subscribe', { code, token }) as Promise<RoomView>;
    return { repository, service, execute, view, setNow(value: number) { now = value; } };
  }

  test(`${backend}: pairing grants the master once, allows the same retry, and expires`, async () => {
    const { execute, view, setNow } = setup();
    const ticket = await execute('room:prepare', {}) as { code: string; ticket: string; expiresAt: number };
    assert.equal('token' in ticket, false);
    assert.equal((await view(ticket.code)).masterReady, false);
    await assert.rejects(execute('room:claim', { code: ticket.code, ticket: 'forged' }), /link|ticket|claim/i);
    const master = await execute('room:claim', ticket, 'claim-1') as Session;
    assert.equal((await view(ticket.code, master.token)).isMaster, true);
    assert.equal((await view(ticket.code)).masterReady, true);
    assert.deepEqual(await execute('room:claim', ticket, 'claim-1'), master);
    await assert.rejects(execute('room:claim', ticket, 'claim-2'), /claimed|used|link/i);
    await assert.rejects(execute('room:claim', { ...ticket, ticket: 'forged' }, 'claim-1'), /link|ticket|request/i);
    const expired = await execute('room:prepare', {}) as typeof ticket;
    setNow(expired.expiresAt);
    await assert.rejects(execute('room:claim', expired), /expired/i);
  });

  test(`${backend}: concurrent claims cannot steal an already claimed room`, async () => {
    const { execute } = setup();
    const ticket = await execute('room:prepare', {}) as { code: string; ticket: string };
    const results = await Promise.allSettled([execute('room:claim', ticket, 'phone-a'), execute('room:claim', ticket, 'phone-b')]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  });

  test(`${backend}: concurrent joins preserve capacity and seats survive a fresh service`, async () => {
    const { execute, repository } = setup();
    const master = await execute('room:create', {}) as Session;
    await execute('room:command', { ...master, action: { type: 'settings', settings: { maxPlayers: 4 } } });
    const joins = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => execute('room:join', { code: master.code, name: `Player ${index}`, gender: 'any' }, `join-${index}`)));
    const seats = joins.filter((value): value is PromiseFulfilledResult<unknown> => value.status === 'fulfilled').map(value => value.value as Session);
    assert.equal(seats.length, 4);
    const restarted = new OnlineGameService({ repository, now: () => 100_000 });
    const recovered = await restarted.execute('room:subscribe', seats[0]) as RoomView;
    assert.equal(recovered.players.length, 4);
    assert.equal(recovered.me?.playerId, seats[0].playerId);
    assert.equal((await restarted.execute('room:subscribe', master) as RoomView).masterReady, true);
  });

  test(`${backend}: simultaneous votes are private and command replay advances only once`, async () => {
    const { execute, view } = setup();
    const master = await execute('room:create', {}) as Session;
    const players = await Promise.all(Array.from({ length: 4 }, (_, index) => execute('room:join', { code: master.code, name: `Player ${index}`, gender: 'any' }))) as Session[];
    const command = (action: unknown, requestId?: string) => execute('room:command', { ...master, action }, requestId);
    await command({ type: 'start' });
    await Promise.all([command({ type: 'advance' }, 'advance-1'), command({ type: 'advance' }, 'advance-1')]);
    assert.equal((await view(master.code)).round, 1);
    await command({ type: 'advance' });
    await command({ type: 'advance' });
    await command({ type: 'advance' });
    const replay = await command({ type: 'advance' }, 'advance-1') as RoomView;
    assert.equal(replay.phase, 'voting');
    assert.equal(typeof replay.revision, 'number');
    await Promise.all(players.map((player, index) => execute('room:command', { ...player, action: { type: 'vote', playerId: players[(index + 1) % 4].playerId } }, `vote-${index}`)));
    assert.equal((await view(master.code)).votesCount, 4);
    const publicJson = JSON.stringify(await view(master.code));
    for (const session of [master, ...players]) assert.equal(publicJson.includes(session.token), false);
    assert.equal(publicJson.includes('alignment'), false);
    assert.equal(publicJson.includes('votedFor'), false);
    await assert.rejects(execute('room:command', { ...master, token: 'forged', action: { type: 'reset' } }), /token/i);
    await assert.rejects(execute('room:command', { ...players[0], action: { type: 'reset' } }), /master/i);
    await assert.rejects(command({ type: 'reset' }, 'advance-1'), /request|reused/i);
  });

  test(`${backend}: subscription presence expires and the room expires after twelve hours`, async () => {
    const { execute, view, setNow } = setup();
    const master = await execute('room:create', {}) as Session;
    const player = await execute('room:join', { code: master.code, name: 'Alex', gender: 'any' }) as Session;
    assert.equal((await view(master.code, player.token)).players[0].connected, true);
    setNow(116_000);
    assert.equal((await view(master.code)).players[0].connected, false);
    await view(master.code, player.token);
    assert.equal((await view(master.code)).players[0].connected, true);
    setNow(100_000 + 12 * 60 * 60 * 1000);
    await assert.rejects(view(master.code), /expired|found/i);
  });
}
