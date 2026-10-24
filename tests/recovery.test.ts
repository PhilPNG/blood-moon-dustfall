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

for (const backend of ['memory', 'sqlite'] as const) {
  function setup() {
    let now = 100_000;
    const database = backend === 'sqlite' ? new DatabaseSync(':memory:') : undefined;
    if (database) database.exec(readFileSync(new URL('../drizzle/0000_rooms.sql', import.meta.url), 'utf8'));
    const repository = database ? new D1RoomRepository(sqliteBinding(database)) : new MemoryRoomRepository();
    const service = new OnlineGameService({ repository, now: () => now });
    const execute = (event: string, payload: unknown, requestId?: string) => service.execute(event, payload, { requestId });
    const view = (session: Pick<Session, 'code'> & Partial<Session>, clientId?: string) => execute('room:subscribe', { ...session, clientId }) as Promise<RoomView>;
    const command = (session: Session, action: unknown, receipt?: string) => execute('room:command', { code: session.code, token: session.token, action }, receipt) as Promise<RoomView>;
    async function party() {
      const master = await execute('room:create', { name: '  Morgan   Lee  ' }) as Session;
      const players: Session[] = [];
      for (let i = 0; i < 4; i++) players.push(await execute('room:join', { code: master.code, name: `Guest ${i + 1}`, gender: 'any' }, `join-seat-${i}`) as Session);
      return { master, players };
    }
    return { database, repository, service, execute, view, command, party, setNow(value: number) { now = value; } };
  }

  test(`${backend}: private recovery credentials survive a service restart without appearing in durable plaintext or public views`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    assert.equal(master.name, 'Morgan Lee');
    assert.match(master.recoveryCode!, /^[A-HJ-NP-Z2-9]{12}$/);
    assert.equal(master.expiresAt, 43_300_000);
    const publicView = await f.view({ code: master.code });
    assert.equal(publicView.gameMaster?.name, 'Morgan Lee');
    assert.equal(publicView.gameMaster?.connected, false);
    const stored = await f.repository.get(master.code);
    for (const session of [master, ...players]) {
      assert.match(session.recoveryCode!, /^[A-HJ-NP-Z2-9]{12}$/);
      assert.equal(stored!.state.includes(session.recoveryCode!), false);
      assert.equal(JSON.stringify(publicView).includes(session.token), false);
      assert.equal(JSON.stringify(publicView).includes(session.recoveryCode!), false);
    }
    const restarted = new OnlineGameService({ repository: f.repository, now: () => 100_000 });
    const recovered = await restarted.execute('room:recover', { code: master.code, kind: 'player', recoveryCode: players[0].recoveryCode!.toLowerCase().replace(/(.{4})/g, '$1 - ') }, { requestId: 'recover-restart' }) as Session;
    assert.equal(recovered.playerId, players[0].playerId);
    assert.notEqual(recovered.token, players[0].token);
    assert.notEqual(recovered.recoveryCode, players[0].recoveryCode);
    await assert.rejects(f.view(players[0]), /revoked|token/i);
    await assert.rejects(f.execute('room:recover', { code: master.code, kind: 'player', recoveryCode: players[0].recoveryCode }), /code/i);
    assert.deepEqual(await restarted.execute('room:recover', { code: master.code, kind: 'player', recoveryCode: players[0].recoveryCode!.toLowerCase().replace(/(.{4})/g, '$1 - ') }, { requestId: 'recover-restart' }), recovered);
  });

  test(`${backend}: recovery preserves the exact private player state through every phase and bypasses locked full rooms`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    await f.command(master, { type: 'settings', settings: { maxPlayers: 4, rounds: 1 } });
    await f.command(master, { type: 'lock', locked: true });
    let player = players[0];
    async function recoverPreservingState() {
      const before = await f.view(player);
      const previous = player;
      player = await f.execute('room:recover', { code: master.code, kind: 'player', recoveryCode: player.recoveryCode }) as Session;
      const after = await f.view(player);
      assert.deepEqual(after.me, before.me);
      assert.equal(after.players.length, 4);
      assert.equal(after.gameId, before.gameId);
      assert.equal(after.phase, before.phase);
      await assert.rejects(f.view(previous), /revoked|token/i);
    }
    await recoverPreservingState();
    await f.command(master, { type: 'start' });
    await f.command(player, { type: 'ready', ready: true });
    await recoverPreservingState();
    await f.command(master, { type: 'advance' });
    const active = await f.view(player);
    await f.command(player, { type: 'publish-clue', clueId: active.me!.clues[0].id });
    await f.command(player, { type: 'search', locationId: active.act!.locations[0].id });
    await f.command(player, { type: 'answer', optionId: active.act!.question.options[0].id });
    await f.command(player, { type: 'suspect', playerId: players[1].playerId });
    await recoverPreservingState();
    await f.command(master, { type: 'advance' });
    await f.command(player, { type: 'vote', playerId: players[1].playerId });
    await recoverPreservingState();
    await assert.rejects(f.command(player, { type: 'vote', playerId: players[2].playerId }), /final/i);
    await f.command(master, { type: 'advance' });
    await recoverPreservingState();
    assert.ok((await f.view(player)).result?.solution);
  });

  test(`${backend}: independent devices close immediately and delayed polls cannot revive a closed slot`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    await f.view(players[0], 'tab-a');
    await f.view(players[0], 'tab-b');
    await f.execute('room:unsubscribe', { code: master.code, token: players[0].token, clientId: 'tab-a' });
    assert.equal((await f.view({ code: master.code })).players[0].connected, true);
    await f.execute('room:leave', { code: master.code, token: players[0].token, clientId: 'tab-b', release: false });
    await f.view(players[0], 'tab-a');
    await f.view(players[0], 'tab-b');
    assert.equal((await f.view({ code: master.code })).players[0].connected, false);
    const resumed = await f.view(players[0], 'tab-c');
    assert.equal(resumed.players[0].connected, true);
    assert.equal(resumed.me?.playerId, players[0].playerId);
    f.setNow(115_000);
    assert.equal((await f.view({ code: master.code })).players[0].connected, false);
  });

  test(`${backend}: refreshing an existing eighth device does not evict another live device`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    for (const clientId of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) await f.view(players[0], clientId);
    f.setNow(105_000);
    await f.view(players[0], 'H');
    for (const clientId of ['B', 'C', 'D', 'E', 'F', 'G', 'H']) await f.execute('room:unsubscribe', { code: master.code, token: players[0].token, clientId });
    assert.equal((await f.view({ code: master.code })).players[0].connected, true);
    f.setNow(115_000);
    assert.equal((await f.view({ code: master.code })).players[0].connected, false);
  });

  test(`${backend}: lobby release revokes sessions, frees name and capacity, and invalidates a backup and offer`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    await f.command(master, { type: 'settings', settings: { maxPlayers: 4 } });
    await f.execute('room:gm-profile', { code: master.code, token: master.token, name: 'Morgan', backupPlayerId: players[0].playerId });
    await f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: players[0].playerId });
    const leave = { code: master.code, token: players[0].token, release: true };
    assert.deepEqual(await f.execute('room:leave', leave, 'release-seat'), { left: true });
    assert.deepEqual(await f.execute('room:leave', leave, 'release-seat'), { left: true });
    const room = await f.view({ code: master.code });
    assert.equal(room.players.length, 3);
    assert.equal(room.gameMaster?.backupPlayerId, undefined);
    assert.equal(room.gameMaster?.handoff, undefined);
    await assert.rejects(f.view(players[0]), /token|revoked/i);
    await assert.rejects(f.execute('room:recover', { code: master.code, kind: 'player', recoveryCode: players[0].recoveryCode }), /code/i);
    await assert.rejects(f.execute('room:join', { code: master.code, name: 'Guest 1', gender: 'any' }, 'join-seat-0'), /token|revoked/i);
    const replacement = await f.execute('room:join', { code: master.code, name: 'Guest 1', gender: 'any' }) as Session;
    assert.notEqual(replacement.playerId, players[0].playerId);
  });

  test(`${backend}: started seats cannot be released and stepping away preserves an absent culprit and vote target`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    await f.command(master, { type: 'settings', settings: { rounds: 1 } });
    await f.command(master, { type: 'start' });
    const culprit = (await Promise.all(players.map(async player => ({ player, view: await f.view(player) })))).find(value => value.view.me?.role?.alignment === 'culprit')!.player;
    await assert.rejects(f.execute('room:leave', { code: master.code, token: culprit.token, release: true }), /lobby/i);
    await f.execute('room:leave', { code: master.code, token: culprit.token, release: false, clientId: 'default' });
    await f.command(master, { type: 'advance' });
    await f.command(master, { type: 'advance' });
    const voter = players.find(player => player.playerId !== culprit.playerId)!;
    await f.command(voter, { type: 'vote', playerId: culprit.playerId });
    const result = await f.command(master, { type: 'advance' });
    assert.equal(result.result?.culpritId, culprit.playerId);
    assert.equal(result.result?.caught, true);
    assert.equal(result.players.length, 4);
  });

  test(`${backend}: GM presence and takeover enforce exact boundaries, roster eligibility, and reconnect cancellation`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    await f.view(master, 'gm-a');
    await f.view(players[0], 'guest-a');
    assert.equal((await f.view({ code: master.code })).gameMaster?.connected, true);
    f.setNow(114_999);
    assert.equal((await f.view({ code: master.code })).gameMaster?.connected, true);
    f.setNow(115_000);
    const absent = (await f.view({ code: master.code })).gameMaster!;
    assert.equal(absent.connected, false);
    assert.equal(absent.takeoverAt, 160_000);
    f.setNow(159_999);
    await f.view(players[0], 'guest-a');
    await assert.rejects(f.execute('room:gm-takeover', { code: master.code, token: players[0].token }), /yet|available/i);
    f.setNow(160_000);
    await f.view(players[1], 'guest-b');
    assert.equal((await f.view({ code: master.code })).gameMaster?.eligiblePlayerId, players[0].playerId);
    await assert.rejects(f.execute('room:gm-takeover', { code: master.code, token: players[1].token }), /eligible|selected/i);
    await f.view(master, 'gm-return');
    await assert.rejects(f.execute('room:gm-takeover', { code: master.code, token: players[0].token }), /yet|available/i);
    f.setNow(220_000);
    await f.view(players[0], 'guest-a');
    const promoted = await f.execute('room:gm-takeover', { code: master.code, token: players[0].token }, 'takeover-once') as Session;
    assert.equal(promoted.name, 'Guest 1');
    assert.equal((await f.view(promoted, 'gm-new')).isMaster, true);
    assert.equal((await f.view(players[0], 'still-player')).me?.playerId, players[0].playerId);
    await assert.rejects(f.view(master), /token|revoked/i);
    await assert.rejects(f.execute('room:recover', { code: master.code, kind: 'master', recoveryCode: master.recoveryCode }), /code/i);
    assert.deepEqual(await f.execute('room:gm-takeover', { code: master.code, token: players[0].token }, 'takeover-once'), promoted);
  });

  test(`${backend}: nominated backup suppresses automatic fallback while away and demos never become eligible`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    await f.command(master, { type: 'demo-fill' });
    await f.execute('room:gm-profile', { code: master.code, token: master.token, name: 'Morgan', backupPlayerId: players[1].playerId });
    f.setNow(160_000);
    await f.view(players[0], 'guest');
    assert.equal((await f.view({ code: master.code })).gameMaster?.eligiblePlayerId, undefined);
    await assert.rejects(f.execute('room:gm-takeover', { code: master.code, token: players[0].token }), /eligible|selected/i);
    await f.view(players[1], 'backup');
    assert.equal((await f.view({ code: master.code })).gameMaster?.eligiblePlayerId, players[1].playerId);
    const demo = (await f.view({ code: master.code })).players.find(player => player.isDemo)!;
    await assert.rejects(f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: demo.id }), /real|demo/i);
    await f.execute('room:gm-profile', { code: master.code, token: master.token, name: 'Morgan', backupPlayerId: null });
    assert.equal((await f.view({ code: master.code })).gameMaster?.backupPlayerId, undefined);
  });

  test(`${backend}: explicit targeted handoff expires, rotates GM authority, and retains the promoted player's private progress`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    await f.command(master, { type: 'start' });
    const playerBefore = (await f.view(players[1])).me;
    await f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: players[1].playerId });
    await assert.rejects(f.execute('room:gm-accept', { code: master.code, token: players[0].token }), /offered|offer/i);
    f.setNow(220_000);
    await assert.rejects(f.execute('room:gm-accept', { code: master.code, token: players[1].token }), /offer/i);
    await f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: players[1].playerId });
    const promoted = await f.execute('room:gm-accept', { code: master.code, token: players[1].token }, 'accept-handoff') as Session;
    assert.deepEqual((await f.view(players[1])).me, playerBefore);
    const gm = await f.view(promoted);
    assert.equal(gm.isMaster, true);
    assert.equal(gm.me, undefined);
    assert.equal(gm.gameMaster?.epoch, 2);
    assert.equal(gm.gameMaster?.handoff, undefined);
    await assert.rejects(f.view(master), /token|revoked/i);
    assert.deepEqual(await f.execute('room:gm-accept', { code: master.code, token: players[1].token }, 'accept-handoff'), promoted);
    await f.execute('room:recovery', { code: master.code, token: promoted.token }, 'new-gm-code');
    await assert.rejects(f.execute('room:gm-accept', { code: master.code, token: players[1].token }, 'accept-handoff'), /code|revoked|session/i);
  });

  test(`${backend}: a promoted GM phone keeps only its own retained seat connected through reset/recovery and expires on disconnect`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    const seat = players[1];
    await f.command(master, { type: 'start' });
    const before = (await f.view(seat, 'bea-player')).me;
    await f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: seat.playerId });
    const promoted = await f.execute('room:gm-accept', { code: master.code, token: seat.token }) as Session;
    await f.execute('room:unsubscribe', { code: master.code, token: seat.token, clientId: 'bea-player' });
    let gm = await f.view(promoted, 'bea-master');
    assert.equal(gm.gameMaster!.connected, true);
    assert.equal(gm.players.find(player => player.id === seat.playerId)!.connected, true, 'the same authenticated phone still represents its retained character');
    assert.equal(gm.players.filter(player => player.connected).length, 1);
    assert.equal(gm.me, undefined, 'master presence cannot project a private player dossier');
    const publicView = await f.view({ code: master.code });
    assert.equal(Object.hasOwn(publicView.gameMaster!, 'linkedPlayerId'), false);
    for (const session of [master, promoted, ...players]) assert.equal(JSON.stringify(publicView).includes(session.token), false);
    assert.deepEqual((await f.view(seat, 'private-check')).me, before);
    await f.execute('room:unsubscribe', { code: master.code, token: seat.token, clientId: 'private-check' });
    const restarted = new OnlineGameService({ repository: f.repository, now: () => 100_000 });
    const restored = await restarted.execute('room:subscribe', { code: master.code, token: promoted.token, clientId: 'bea-master' }) as RoomView;
    assert.equal(restored.players.find(player => player.id === seat.playerId)!.connected, true);
    await f.command(promoted, { type: 'reset' });
    assert.equal((await f.view({ code: master.code })).players.find(player => player.id === seat.playerId)!.connected, true);
    await f.execute('room:unsubscribe', { code: master.code, token: promoted.token, clientId: 'bea-master' });
    await f.view(promoted, 'bea-master'); // A closed lifetime cannot revive either identity.
    gm = await f.view({ code: master.code });
    assert.equal(gm.gameMaster!.connected, false); assert.equal(gm.players.find(player => player.id === seat.playerId)!.connected, false);
    await f.view(promoted, 'bea-master-reconnected');
    assert.equal((await f.view({ code: master.code })).players.find(player => player.id === seat.playerId)!.connected, true);
    f.setNow(115_000);
    gm = await f.view({ code: master.code });
    assert.equal(gm.gameMaster!.connected, false); assert.equal(gm.players.find(player => player.id === seat.playerId)!.connected, false);
    const recovered = await f.execute('room:recover', { code: master.code, kind: 'master', recoveryCode: promoted.recoveryCode }) as Session;
    gm = await f.view(recovered, 'replacement-gm');
    assert.equal(gm.players.find(player => player.id === seat.playerId)!.connected, true);
    await assert.rejects(f.view(promoted), /token|revoked/i);
    await f.execute('room:leave', { code: master.code, token: seat.token, release: true });
    const rejoined = await f.execute('room:join', { code: master.code, name: seat.name, gender: 'any' }) as Session;
    assert.notEqual(rejoined.playerId, seat.playerId);
    gm = await f.view(recovered, 'replacement-gm');
    assert.equal(gm.gameMaster!.connected, true);
    assert.equal(gm.players.find(player => player.id === rejoined.playerId)!.connected, false, 'a newly joined namesake cannot inherit the previous seat connection');
  });

  test(`${backend}: a second handoff replaces the linked seat and ordinary GM names never imply a player connection`, async () => {
    const f = setup(); const { master, players } = await f.party();
    await f.execute('room:gm-profile', { code: master.code, token: master.token, name: players[0].name });
    assert.equal((await f.view(master, 'ordinary-gm')).players.some(player => player.connected), false);
    await f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: players[0].playerId });
    const first = await f.execute('room:gm-accept', { code: master.code, token: players[0].token }) as Session;
    assert.equal((await f.view(first, 'first-gm')).players[0].connected, true);
    await f.execute('room:gm-offer', { code: master.code, token: first.token, playerId: players[1].playerId });
    const second = await f.execute('room:gm-accept', { code: master.code, token: players[1].token }) as Session;
    const current = await f.view(second, 'second-gm');
    assert.equal(current.players[0].connected, false); assert.equal(current.players[1].connected, true);
    await assert.rejects(f.view(first, 'first-gm'), /token|revoked/i);
  });

  test(`${backend}: an eligible takeover links the authenticated player's retained seat to its new GM presence`, async () => {
    const f = setup(); const { master, players } = await f.party();
    f.setNow(160_000); await f.view(players[0], 'takeover-player');
    const recovered = await f.execute('room:gm-takeover', { code: master.code, token: players[0].token }) as Session;
    await f.execute('room:unsubscribe', { code: master.code, token: players[0].token, clientId: 'takeover-player' });
    const gm = await f.view(recovered, 'takeover-gm');
    assert.equal(gm.players[0].connected, true); assert.equal(gm.players.slice(1).some(player => player.connected), false);
  });

  test(`${backend}: concurrent recovery and targeted accepts have exactly one winner and stale receipts never restore authority`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    const payload = { code: master.code, kind: 'player', recoveryCode: players[0].recoveryCode };
    const recovered = await Promise.allSettled([f.execute('room:recover', payload, 'race-code-a'), f.execute('room:recover', payload, 'race-code-b')]);
    assert.equal(recovered.filter(result => result.status === 'fulfilled').length, 1);
    await f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: players[1].playerId });
    const accepts = await Promise.allSettled([f.execute('room:gm-accept', { code: master.code, token: players[1].token }, 'race-gm-a'), f.execute('room:gm-accept', { code: master.code, token: players[1].token }, 'race-gm-b')]);
    assert.equal(accepts.filter(result => result.status === 'fulfilled').length, 1);
    await assert.rejects(f.execute('room:join', { code: master.code, name: 'Guest 1', gender: 'any' }, 'join-seat-0'), /token|revoked/i);
    await assert.rejects(f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: players[1].playerId }), /token|revoked/i);
  });

  test(`${backend}: a revoked player credential cannot replay its earlier promotion to obtain current GM access`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    await f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: players[0].playerId });
    const accept = { code: master.code, token: players[0].token };
    const promoted = await f.execute('room:gm-accept', accept, 'promotion-receipt') as Session;
    const recoveredPlayer = await f.execute('room:recover', { code: master.code, kind: 'player', recoveryCode: players[0].recoveryCode }) as Session;
    assert.equal((await f.view(recoveredPlayer)).me?.playerId, players[0].playerId);
    assert.equal((await f.view(promoted)).isMaster, true);
    await assert.rejects(f.execute('room:gm-accept', accept, 'promotion-receipt'), /token|revoked/i);
  });

  test(`${backend}: same-bearer recovery codes have monotonic revisions even at the same timestamp`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    const original = players[0];
    const payload = { code: master.code, token: original.token };
    const first = await f.execute('room:recovery', payload, 'code-version-first') as Session;
    const second = await f.execute('room:recovery', payload, 'code-version-second') as Session;
    assert.equal(first.token, original.token);
    assert.equal(second.token, original.token);
    assert.equal(first.updatedAt, second.updatedAt);
    assert.equal(typeof original.recoveryRevision, 'number');
    assert.equal(first.recoveryRevision, original.recoveryRevision! + 1);
    assert.equal(second.recoveryRevision, first.recoveryRevision! + 1);
    assert.deepEqual(await f.execute('room:recovery', payload, 'code-version-second'), second);
    await assert.rejects(f.execute('room:recovery', payload, 'code-version-first'), /replaced/i);
    const recovered = await f.execute('room:recover', { code: master.code, kind: 'player', recoveryCode: second.recoveryCode }) as Session;
    assert.equal(recovered.recoveryRevision, second.recoveryRevision! + 1);
    await f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: players[1].playerId });
    const promoted = await f.execute('room:gm-accept', { code: master.code, token: players[1].token }) as Session;
    assert.equal(promoted.recoveryRevision, master.recoveryRevision! + 1);
  });

  test(`${backend}: master recovery preserves profile and clock while invalidating claim and recovery receipts`, async () => {
    const f = setup();
    const ticket = await f.execute('room:prepare', { name: 'Avery' }) as { code: string; ticket: string };
    const master = await f.execute('room:claim', ticket, 'original-claim') as Session;
    assert.equal(master.name, 'Avery');
    const players = await Promise.all(Array.from({ length: 4 }, (_, index) => f.execute('room:join', { code: master.code, name: `Guest ${index}`, gender: 'any' }))) as Session[];
    await f.command(master, { type: 'start' });
    await f.command(master, { type: 'advance' });
    await f.execute('room:gm-profile', { code: master.code, token: master.token, name: 'Avery Renamed', backupPlayerId: players[0].playerId });
    const before = await f.view(master, 'old-gm');
    const payload = { code: master.code, kind: 'master', recoveryCode: master.recoveryCode };
    const recovered = await f.execute('room:recover', payload, 'master-recovery') as Session;
    const after = await f.view(recovered, 'new-gm');
    assert.equal(recovered.name, 'Avery Renamed');
    assert.deepEqual(after.timer, before.timer);
    assert.equal(after.gameId, before.gameId);
    assert.equal(after.gameMaster?.backupPlayerId, players[0].playerId);
    assert.equal(after.gameMaster?.epoch, 2);
    await assert.rejects(f.execute('room:claim', ticket, 'original-claim'), /token|revoked/i);
    assert.deepEqual(await f.execute('room:recover', payload, 'master-recovery'), recovered);
    const refresh = { code: master.code, token: recovered.token };
    const regenerated = await f.execute('room:recovery', refresh, 'regenerate-code') as Session;
    assert.equal(regenerated.token, recovered.token);
    assert.notEqual(regenerated.recoveryCode, recovered.recoveryCode);
    assert.deepEqual(await f.execute('room:recovery', refresh, 'regenerate-code'), regenerated);
    await assert.rejects(f.execute('room:recover', payload, 'master-recovery'), /replaced|revoked/i);
    await assert.rejects(f.execute('room:recover', { code: master.code, kind: 'master', recoveryCode: recovered.recoveryCode }), /code/i);
  });

  test(`${backend}: concurrent takeovers and a racing GM reconnect cannot install two controllers`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    f.setNow(160_000);
    await f.view(players[0], 'guest');
    const payload = { code: master.code, token: players[0].token };
    const results = await Promise.allSettled([f.execute('room:gm-takeover', payload, 'takeover-race-a'), f.execute('room:gm-takeover', payload, 'takeover-race-b'), f.view(master, 'gm-return-race')]);
    const controllers = results.slice(0, 2).filter(result => result.status === 'fulfilled');
    const reconnect = results[2];
    assert.equal(controllers.length + (reconnect.status === 'fulfilled' ? 1 : 0), 1);
    if (controllers.length) {
      const promoted = (controllers[0] as PromiseFulfilledResult<unknown>).value as Session;
      assert.equal((await f.view(promoted)).isMaster, true);
      await assert.rejects(f.view(master), /token|revoked/i);
    } else assert.equal((await f.view(master)).isMaster, true);
  });

  test(`${backend}: GM kick invalidates private recovery and all target selections`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    await f.execute('room:gm-profile', { code: master.code, token: master.token, name: 'Morgan', backupPlayerId: players[0].playerId });
    await f.execute('room:gm-offer', { code: master.code, token: master.token, playerId: players[0].playerId });
    const kicked = await f.command(master, { type: 'kick', playerId: players[0].playerId });
    assert.equal(kicked.gameMaster?.backupPlayerId, undefined);
    assert.equal(kicked.gameMaster?.handoff, undefined);
    await assert.rejects(f.execute('room:recover', { code: master.code, kind: 'player', recoveryCode: players[0].recoveryCode }), /code/i);
    await assert.rejects(f.execute('room:join', { code: master.code, name: 'Guest 1', gender: 'any' }, 'join-seat-0'), /token|revoked/i);
  });

  test(`${backend}: legacy rooms get one fresh grace window and expired rooms cannot recover`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    const stored = (await f.repository.get(master.code))!;
    const envelope = JSON.parse(stored.state);
    delete envelope.gameMaster; delete envelope.recovery; delete envelope.closedPresence;
    await f.repository.compareAndSwap({ ...stored, state: JSON.stringify(envelope) }, stored.revision);
    f.setNow(500_000);
    const first = await f.view({ code: master.code });
    assert.equal(first.gameMaster?.takeoverAt, 560_000);
    f.setNow(530_000);
    assert.equal((await f.view({ code: master.code })).gameMaster?.takeoverAt, 560_000);
    const code = await f.execute('room:recovery', { code: master.code, token: players[0].token }, 'legacy-private-code') as Session;
    assert.match(code.recoveryCode!, /^[A-HJ-NP-Z2-9]{12}$/);
    f.setNow(master.expiresAt!);
    await assert.rejects(f.execute('room:recover', { code: master.code, kind: 'player', recoveryCode: code.recoveryCode }), /expired|found/i);
  });

  test(`${backend}: recovery validation is localized and forged callers gain no new authority`, async () => {
    const f = setup();
    const { master, players } = await f.party();
    for (const language of ['en', 'es', 'pt-BR']) {
      const reply = await executeRpc(f.service, { event: 'room:recover', payload: { code: master.code, kind: 'player', recoveryCode: 'AAAAAAAAAAAA', language }, requestId: `invalid-${language}` });
      assert.equal(reply.ok, false);
      assert.ok(reply.error);
      if (language !== 'en') assert.notEqual(reply.error, 'That recovery code is invalid or has been replaced.');
    }
    for (const event of ['room:recovery', 'room:gm-profile', 'room:gm-offer', 'room:gm-accept', 'room:gm-takeover']) {
      await assert.rejects(f.execute(event, { code: master.code, token: 'forged', name: 'Fake', playerId: players[0].playerId }), /token|session/i);
    }
    await assert.rejects(f.execute('room:gm-profile', { code: master.code, token: players[0].token, name: 'Fake' }), /master/i);
    await assert.rejects(f.execute('room:leave', { code: master.code, token: master.token, release: true }), /players|player/i);
  });
}
