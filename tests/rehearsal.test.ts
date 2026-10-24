import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { GameEngine, type RoomSnapshot } from '../server/engine.js';
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

test('only an explicit boolean enables rehearsal and zero players cannot start either room mode', () => {
  const engine = new GameEngine();
  for (const invalid of ['true', 'false', 1, 0, null, {}, []]) assert.throws(() => engine.create({ rehearsal: invalid }), /rehearsal|request/i);
  for (const rehearsal of [false, true]) {
    const master = engine.create({ rehearsal });
    assert.equal(engine.view(master.code).rehearsal, rehearsal);
    assert.equal(engine.view(master.code).settings.maxPlayers, 20);
    assert.throws(() => engine.command(master.code, master.token, { type: 'start' }), rehearsal ? /1 player/i : /4 players/i);
    assert.equal(engine.view(master.code).phase, 'lobby');
  }
  const ordinary = engine.create();
  assert.equal(engine.view(ordinary.code).rehearsal, false);
});

test('ordinary rooms reject one and three guests, while four guests can start', () => {
  const engine = new GameEngine();
  const master = engine.create();
  for (let index = 0; index < 4; index++) {
    engine.join({ code: master.code, name: `Guest ${index}`, gender: 'any', rehearsal: true });
    if (index === 0 || index === 2) assert.throws(() => engine.command(master.code, master.token, { type: 'start' }), /4 players/i);
  }
  assert.equal(engine.view(master.code).rehearsal, false);
  engine.command(master.code, master.token, { type: 'start' });
  assert.equal(engine.view(master.code).phase, 'roles');
});

test('rehearsal mode survives JSON restore and reset while legacy snapshots stay ordinary', () => {
  const engine = new GameEngine();
  const master = engine.create({ rehearsal: true });
  engine.join({ code: master.code, name: 'Developer', gender: 'any' });
  engine.command(master.code, master.token, { type: 'start' });
  const snapshot = JSON.parse(JSON.stringify(engine.exportRoom(master.code))) as RoomSnapshot;
  const restored = new GameEngine();
  restored.restoreRoom(snapshot);
  assert.equal(restored.view(master.code).rehearsal, true);
  assert.equal(restored.view(master.code).phase, 'roles');
  restored.command(master.code, master.token, { type: 'reset' });
  assert.equal(restored.view(master.code).rehearsal, true);
  restored.command(master.code, master.token, { type: 'start' });
  assert.equal(restored.view(master.code).phase, 'roles');

  delete snapshot.rehearsal;
  snapshot.phase = 'lobby';
  const legacy = new GameEngine();
  legacy.restoreRoom(snapshot);
  assert.equal(legacy.view(master.code).rehearsal, false);
  assert.throws(() => legacy.command(master.code, master.token, { type: 'start' }), /4 players/i);
});

test('neither settings nor forged actions can change a room mode or grant player GM authority', () => {
  for (const rehearsal of [false, true]) {
    const engine = new GameEngine();
    const master = engine.create({ rehearsal });
    const player = engine.join({ code: master.code, name: 'Developer', gender: 'any' });
    assert.throws(() => engine.command(master.code, master.token, { type: 'settings', settings: { rehearsal: !rehearsal } }), /setting/i);
    assert.throws(() => engine.command(master.code, master.token, { type: 'rehearsal', rehearsal: !rehearsal }), /action|players/i);
    assert.throws(() => engine.command(master.code, player.token, { type: 'start', rehearsal: true }), /master/i);
    assert.throws(() => engine.command(master.code, undefined, { type: 'start', rehearsal: true }), /token/i);
    assert.equal(engine.view(master.code).rehearsal, rehearsal);
  }
});

for (const backend of ['memory', 'sqlite'] as const) {
  function setup() {
    const now = 100_000;
    const database = backend === 'sqlite' ? new DatabaseSync(':memory:') : undefined;
    if (database) database.exec(readFileSync(new URL('../drizzle/0000_rooms.sql', import.meta.url), 'utf8'));
    const repository = database ? new D1RoomRepository(sqliteBinding(database)) : new MemoryRoomRepository();
    const service = new OnlineGameService({ repository, now: () => now });
    const execute = (event: string, payload: unknown, requestId?: string) => service.execute(event, payload, { requestId });
    const view = (session: Pick<Session, 'code'> & Partial<Session>) => execute('room:subscribe', { code: session.code, token: session.token }) as Promise<RoomView>;
    const command = (session: Session, action: unknown) => execute('room:command', { code: session.code, token: session.token, action }) as Promise<RoomView>;
    return { repository, service, execute, view, command };
  }

  async function soloSample() {
    const f = setup();
    const master = await f.execute('room:create', { rehearsal: true }) as Session;
    const human = await f.execute('room:join', { code: master.code, name: 'Developer', gender: 'any' }) as Session;
    await f.command(master, { type: 'demo-fill' });
    const samples = (await f.view(master)).players.filter(player => player.isDemo);
    for (const player of samples.slice(1)) await f.command(master, { type: 'kick', playerId: player.id });
    await f.execute('room:leave', { code: master.code, token: human.token, release: true });
    await f.command(master, { type: 'settings', settings: { rounds: 1 } });
    await f.command(master, { type: 'start' });
    return { ...f, master, sampleId: samples[0].id };
  }

  test(`${backend}: a lone sample guest investigates without suspecting itself`, async () => {
    const f = await soloSample();
    const act = await f.command(f.master, { type: 'advance' });
    assert.equal(act.players.length, 1);
    assert.deepEqual(act.suspicions, { [f.sampleId]: 0 });
    assert.equal(act.searchCount, 1);
    assert.equal(act.answerCount, 1);
    assert.equal(act.clues.length, 1);
  });

  test(`${backend}: a lone sample guest leaves an empty ballot instead of catching itself`, async () => {
    const f = await soloSample();
    await f.command(f.master, { type: 'advance' });
    const voting = await f.command(f.master, { type: 'advance' });
    assert.equal(voting.votesCount, 0);
    assert.equal(voting.players[0].hasVoted, false);
    assert.equal(voting.result, undefined);
    const result = await f.command(f.master, { type: 'advance' });
    assert.equal(result.result!.caught, false);
    assert.deepEqual(result.result!.tallies, { [f.sampleId]: 0 });
    assert.equal(result.result!.scores![0].correctAccusation, false);
    assert.equal(result.result!.scores![0].score, 350, 'one search, shared clue, correct answer and an escaping culprit');
  });

  test(`${backend}: explicit rehearsal preserves named GM recovery and supports the complete real solo game`, async () => {
    const f = setup();
    const master = await f.execute('room:create', { rehearsal: true, name: 'Developer GM' }) as Session;
    assert.equal(master.name, 'Developer GM');
    assert.match(master.recoveryCode!, /^[A-HJ-NP-Z2-9]{12}$/);
    assert.equal((await f.view({ code: master.code })).rehearsal, true);
    await assert.rejects(f.command(master, { type: 'start' }), /1 player/i);
    let player = await f.execute('room:join', { code: master.code, name: 'Developer', gender: 'any' }) as Session;
    await f.command(master, { type: 'settings', settings: { rounds: 1, roundSeconds: 60 } });
    await f.command(master, { type: 'start' });
    const roles = await f.view(player);
    assert.equal(roles.phase, 'roles');
    assert.equal(roles.players.length, 1);
    assert.equal(roles.me?.role?.alignment, 'culprit');
    assert.ok(roles.me?.role?.characterId);
    assert.ok(roles.me?.role?.secret);
    await f.command(player, { type: 'ready', ready: true });
    await f.command(master, { type: 'advance' });
    const investigation = await f.view(player);
    assert.equal(investigation.phase, 'investigation');
    assert.ok(investigation.act!.evidence.length >= 9);
    await f.command(player, { type: 'publish-clue', clueId: investigation.me!.clues[0].id });
    await f.command(player, { type: 'search', locationId: investigation.act!.locations[0].id });
    await f.command(player, { type: 'answer', optionId: investigation.act!.question.options[0].id });
    await assert.rejects(f.command(player, { type: 'suspect', playerId: player.playerId }), /yourself/i);
    const progress = (await f.view(player)).me;
    const restarted = new OnlineGameService({ repository: f.repository, now: () => 100_000 });
    player = await restarted.execute('room:recover', { code: master.code, kind: 'player', recoveryCode: player.recoveryCode }, { requestId: 'rehearsal-device-recovery' }) as Session;
    assert.deepEqual((await f.view(player)).me, progress);
    assert.equal((await f.view(player)).rehearsal, true);
    await f.command(master, { type: 'advance' });
    const voting = await f.view(player);
    assert.equal(voting.phase, 'voting');
    assert.equal(voting.votesCount, 0);
    assert.equal(voting.result, undefined);
    assert.ok(voting.questionResult);
    await assert.rejects(f.command(player, { type: 'vote', playerId: player.playerId }), /yourself/i);
    const result = await f.command(master, { type: 'advance' });
    assert.equal(result.phase, 'results');
    assert.equal(result.result!.culpritId, player.playerId);
    assert.equal(result.result!.caught, false);
    assert.deepEqual(result.result!.tallies, { [player.playerId!]: 0 });
    assert.equal(result.result!.scores!.length, 1);
    assert.ok(result.result!.solution!.summary);
    const publicJson = JSON.stringify(await f.view({ code: master.code }));
    for (const secret of [master.token, master.recoveryCode!, player.token, player.recoveryCode!, roles.me!.role!.secret!]) assert.equal(publicJson.includes(secret), false);
    assert.equal((await f.view(master)).me, undefined);
    await f.command(master, { type: 'reset' });
    const reset = await f.view(player);
    assert.equal(reset.rehearsal, true);
    assert.equal(reset.players.length, 1);
    assert.equal(reset.me!.role, undefined);
    assert.deepEqual(reset.me!.clues, []);
    await f.command(master, { type: 'start' });
    assert.equal((await f.view(player)).phase, 'roles');
  });

  test(`${backend}: ordinary minimums remain authoritative despite client-supplied rehearsal fields`, async () => {
    const f = setup();
    const master = await f.execute('room:create', { name: 'Ordinary GM' }) as Session;
    assert.equal((await f.view(master)).rehearsal, false);
    for (let index = 0; index < 4; index++) {
      await f.execute('room:join', { code: master.code, name: `Ordinary ${index}`, gender: 'any', rehearsal: true });
      if (index === 0 || index === 2) await assert.rejects(f.execute('room:command', { code: master.code, token: master.token, rehearsal: true, action: { type: 'start', rehearsal: true } }), /4 players/i);
    }
    await assert.rejects(f.command(master, { type: 'settings', settings: { rehearsal: true } }), /setting/i);
    await f.command(master, { type: 'start' });
    assert.equal((await f.view(master)).phase, 'roles');
    assert.equal((await f.view(master)).rehearsal, false);
  });

  test(`${backend}: multiplayer rehearsal keeps normal private voting and final verdicts`, async () => {
    const f = setup();
    const master = await f.execute('room:create', { rehearsal: true }) as Session;
    const players: Session[] = [];
    for (let index = 0; index < 4; index++) players.push(await f.execute('room:join', { code: master.code, name: `Guest ${index}`, gender: 'any' }) as Session);
    await f.command(master, { type: 'settings', settings: { rounds: 1 } });
    await f.command(master, { type: 'start' });
    const culprit = (await Promise.all(players.map(async player => ({ player, view: await f.view(player) })))).find(value => value.view.me?.role?.alignment === 'culprit')!.player;
    const innocent = players.find(player => player.playerId !== culprit.playerId)!;
    await f.command(master, { type: 'advance' });
    await f.command(master, { type: 'advance' });
    for (const player of players) await f.command(player, { type: 'vote', playerId: player.playerId === culprit.playerId ? innocent.playerId : culprit.playerId });
    const sealed = await f.view({ code: master.code });
    assert.equal(sealed.votesCount, 4);
    assert.equal(sealed.result, undefined);
    assert.equal(JSON.stringify(sealed).includes('votedFor'), false);
    const result = await f.command(master, { type: 'advance' });
    assert.equal(result.rehearsal, true);
    assert.equal(result.result!.caught, true);
    assert.equal(result.result!.tallies[culprit.playerId!], 3);
  });

  test(`${backend}: service validates creation flags and localizes the solo minimum without widening pairing`, async () => {
    const f = setup();
    for (const invalid of ['true', 1, null]) await assert.rejects(f.execute('room:create', { rehearsal: invalid }), /rehearsal|request/i);
    await assert.rejects(f.execute('room:prepare', { rehearsal: true }), /request/i);
    for (const language of ['en', 'es', 'pt-BR']) {
      const created = await executeRpc(f.service, { event: 'room:create', payload: { rehearsal: true, language }, requestId: `create-rehearsal-${language}` });
      assert.equal(created.ok, true);
      const master = created.data as Session;
      const reply = await executeRpc(f.service, { event: 'room:command', payload: { code: master.code, token: master.token, action: { type: 'start' }, language }, requestId: `minimum-rehearsal-${language}` });
      assert.equal(reply.ok, false);
      assert.equal(reply.errorCode, 'INVALID_REQUEST');
      if (language === 'en') assert.match(reply.error!, /1 player/i);
      else assert.notEqual(reply.error, 'At least 1 player is required.');
    }
  });
}
