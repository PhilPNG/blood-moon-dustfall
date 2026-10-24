import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { GameEngine } from '../server/engine.js';
import { OnlineGameService } from '../online/service.js';
import { D1RoomRepository, MemoryRoomRepository, type D1DatabaseBinding } from '../online/repository.js';
import type { RoomView, Session } from '../shared/types.js';
import { attentionActive, attentionEventKey, attentionRemainingMs } from '../shared/attention.js';
import { cinematicEvent } from '../shared/cinematics.js';
import { playbackEventKey } from '../shared/media-sync.js';

function engineParty() {
  let now = 100_000;
  const engine = new GameEngine({ now: () => now });
  const master = engine.create();
  const players = Array.from({ length: 4 }, (_, index) => engine.join({ code: master.code, name: `Guest ${index}`, gender: 'any' }));
  const command = (action: unknown, session = master) => engine.command(master.code, session.token, action);
  const view = () => engine.view(master.code);
  const cap = engine.claimDisplay(master.code, 'attention-tv');
  return { engine, master, players, command, view, cap, setNow(value: number) { now = value; } };
}

test('phase attention lasts ten authoritative seconds and preserves the entire investigation clock', () => {
  const f = engineParty();
  assert.equal(f.view().attention, undefined);
  f.command({ type: 'start' });
  assert.equal(f.view().attention?.cue, 'phase');
  assert.equal(f.view().attention?.endsAt, 110_000);
  f.command({ type: 'advance' });
  const act = f.view();
  assert.equal(act.timer.startsAt, 110_000);
  assert.equal(act.timer.endsAt, 410_000);
  assert.equal(act.timer.remaining, 300);
  assert.equal(act.attention?.remainingMs, 10_000);
  f.setNow(109_000);
  assert.equal(f.view().timer.remaining, 300);
  const restored = new GameEngine({ now: () => 109_000 });
  restored.restoreRoom(JSON.parse(JSON.stringify(f.engine.exportRoom(f.master.code))));
  assert.deepEqual(restored.view(f.master.code).attention, f.view().attention, 'restore cannot renew the countdown');
  f.setNow(111_000);
  assert.equal(f.view().timer.remaining, 299);
});

test('pause and resume preserve the cue identity and remaining delay rather than starting over', () => {
  const f = engineParty();
  f.command({ type: 'start' }); f.command({ type: 'advance' });
  const id = f.view().attention?.id;
  f.setNow(103_000); f.command({ type: 'pause' });
  assert.equal(f.view().attention?.remainingMs, 7_000);
  assert.equal(f.view().attention?.endsAt, null);
  assert.equal(f.view().timer.remaining, 300);
  f.setNow(200_000); f.command({ type: 'resume' });
  assert.equal(f.view().attention?.id, id);
  assert.equal(f.view().attention?.endsAt, 207_000);
  assert.equal(f.view().timer.startsAt, 207_000);
  assert.equal(f.view().timer.endsAt, 507_000);
  f.setNow(208_000); assert.equal(f.view().timer.remaining, 299);
});

test('replay starts a fresh attention window while skip keeps its current deadline and reset retires it', () => {
  const f = engineParty();
  f.command({ type: 'start' }); f.command({ type: 'advance' });
  const old = f.view().attention;
  f.setNow(120_000); f.command({ type: 'presentation', control: 'replay' });
  const replay = f.view().attention;
  assert.notEqual(replay?.id, old?.id);
  assert.equal(replay?.endsAt, 130_000);
  assert.equal(f.view().timer.remaining, 290);
  f.setNow(123_000); f.command({ type: 'presentation', control: 'skip' });
  assert.equal(f.view().attention?.id, replay?.id);
  assert.equal(f.view().attention?.endsAt, 130_000);
  assert.notEqual(f.view().attention?.eventKey, replay?.eventKey);
  f.command({ type: 'reset' });
  assert.equal(f.view().attention, undefined);
  assert.equal(f.view().timer.startsAt, undefined);
});

test('attention reads the server clock, ignores retired contexts and keeps a paused cue fixed', () => {
  const f = engineParty();
  f.command({ type: 'start' });
  const room = f.view();
  assert.equal(attentionRemainingMs(room), 10_000);
  assert.equal(attentionRemainingMs(room, 104_500), 5_500);
  assert.equal(attentionActive(room, 109_999), true);
  assert.equal(attentionActive(room, 110_000), false);
  assert.equal(attentionRemainingMs({ ...room, phase: 'investigation', round: 1 }), 0);
  f.setNow(103_000); f.command({ type: 'pause' });
  const paused = f.view();
  assert.equal(attentionEventKey(paused), attentionEventKey(room));
  assert.equal(attentionRemainingMs(paused, 999_999), 7_000);
  assert.equal(attentionRemainingMs({ ...paused, attention: undefined }), 0);
});

test('native media cannot report a playing clock before attention finishes, but a legacy room is immediate', () => {
  const f = engineParty();
  f.command({ type: 'start' });
  const report = { eventKey: cinematicEvent(f.view())!.key, clipId: 'opening', kind: 'film', position: 0, playing: true };
  const before = f.engine.exportRoom(f.master.code);
  assert.throws(() => f.engine.reportPlayback(f.master.code, 'attention-tv', f.cap.token, report, 1), /presentation/i);
  assert.deepEqual(f.engine.exportRoom(f.master.code), before);
  f.engine.reportPlayback(f.master.code, 'attention-tv', f.cap.token, { ...report, playing: false }, 1);
  f.setNow(110_000); f.engine.claimDisplay(f.master.code, 'attention-tv', f.cap.token);
  f.engine.reportPlayback(f.master.code, 'attention-tv', f.cap.token, report, 2);
  assert.equal(f.view().playback?.playing, true);

  const snapshot = f.engine.exportRoom(f.master.code);
  delete snapshot.attention; delete snapshot.attentionClaims; delete snapshot.attentionSerial;
  const legacy = new GameEngine({ now: () => 110_000 });
  legacy.restoreRoom(snapshot);
  legacy.reportPlayback(f.master.code, 'attention-tv', f.cap.token, report, 3);
  assert.equal(legacy.view(f.master.code).attention, undefined);
  assert.equal(legacy.view(f.master.code).playback?.playing, true);
});

test('an additional cue retires the prior native media clock even after its countdown finishes', () => {
  const f = engineParty();
  f.command({ type: 'start' }); f.command({ type: 'advance' });
  f.setNow(111_000); f.engine.claimDisplay(f.master.code, 'attention-tv', f.cap.token);
  const report = { eventKey: cinematicEvent(f.view())!.key, clipId: 'act-1', kind: 'film', position: 2, playing: false };
  f.engine.reportPlayback(f.master.code, 'attention-tv', f.cap.token, report, 1);
  const clueId = f.engine.view(f.master.code, f.players[0].token).me!.clues[0].id;
  f.command({ type: 'publish-clue', clueId }, f.players[0]);
  f.engine.claimAttention(f.master.code, 'attention-tv', f.cap.token, { eventKey: attentionEventKey(f.view()), cue: 'clue', clueId });
  f.setNow(122_000); f.engine.claimDisplay(f.master.code, 'attention-tv', f.cap.token);
  const before = f.engine.exportRoom(f.master.code);
  assert.throws(() => f.engine.reportPlayback(f.master.code, 'attention-tv', f.cap.token, { ...report, playing: true }, 2), /playback/i);
  assert.deepEqual(f.engine.exportRoom(f.master.code), before);
});

test('canceling a pending warning retires its native report before the extended investigation continues', () => {
  const f = engineParty();
  f.command({ type: 'start' }); f.command({ type: 'advance' });
  f.setNow(380_000); f.engine.claimDisplay(f.master.code, 'attention-tv', f.cap.token);
  f.engine.claimAttention(f.master.code, 'attention-tv', f.cap.token, { eventKey: attentionEventKey(f.view()), cue: 'timer-warning' });
  const warning = f.view();
  const report = { eventKey: playbackEventKey(warning, `${cinematicEvent(warning)!.key}:narration:timer-warning`), clipId: 'timer-warning', kind: 'narration', position: 0, playing: true };
  f.setNow(385_000); f.command({ type: 'extend-time' });
  const before = f.engine.exportRoom(f.master.code);
  assert.throws(() => f.engine.reportPlayback(f.master.code, 'attention-tv', f.cap.token, report, 1), /playback/i);
  assert.deepEqual(f.engine.exportRoom(f.master.code), before);
});

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
  async function party() {
    let now = 100_000;
    const database = backend === 'sqlite' ? new DatabaseSync(':memory:') : undefined;
    if (database) database.exec(readFileSync(new URL('../drizzle/0000_rooms.sql', import.meta.url), 'utf8'));
    const repository = database ? new D1RoomRepository(sqliteBinding(database)) : new MemoryRoomRepository();
    const service = new OnlineGameService({ repository, now: () => now });
    const master = await service.execute('room:create', {}) as Session;
    const players: Session[] = [];
    for (let index = 0; index < 4; index++) players.push(await service.execute('room:join', { code: master.code, name: `Guest ${index}`, gender: 'any' }) as Session);
    const command = (action: unknown, session = master) => service.execute('room:command', { code: master.code, token: session.token, action }) as Promise<RoomView>;
    const view = () => service.execute('room:subscribe', { code: master.code }) as Promise<RoomView>;
    const cap = await service.execute('room:display-claim', { code: master.code, displayId: 'attention-tv' }) as { token: string };
    const key = (room: RoomView) => `${room.gameId ?? `legacy-${room.code}`}:${room.phase}:${room.round}:attention:${room.actionEpoch ?? 0}:presentation:${room.presentation?.serial ?? 0}`;
    const claim = async (cue: string, patch: Record<string, unknown> = {}) => service.execute('room:attention', { code: master.code, displayId: 'attention-tv', token: cap.token, eventKey: key(await view()), cue, ...patch }) as Promise<{ attention: NonNullable<RoomView['attention']>; serverNow: number }>;
    const renew = () => service.execute('room:display-claim', { code: master.code, displayId: 'attention-tv', token: cap.token });
    return { service, repository, master, players, command, view, claim, renew, cap, setNow(value: number) { now = value; } };
  }

  test(`${backend}: simultaneous eligible clue claims share one durable countdown and retries never renew it`, async () => {
    const f = await party();
    await f.command({ type: 'start' }); await f.command({ type: 'advance' });
    f.setNow(111_000); await f.renew();
    const own = await f.service.execute('room:subscribe', { code: f.master.code, token: f.players[0].token }) as RoomView;
    const clueId = own.me!.clues[0].id;
    await f.command({ type: 'publish-clue', clueId }, f.players[0]);
    const [first, second] = await Promise.all([f.claim('clue', { clueId }), f.claim('clue', { clueId })]);
    assert.deepEqual(first.attention, second.attention);
    assert.equal(first.attention.endsAt, 121_000);
    assert.equal((await f.view()).timer.remaining, 299);
    f.setNow(122_000); await f.renew();
    const retry = await f.claim('clue', { clueId });
    assert.deepEqual(retry.attention, first.attention);
    assert.equal((await f.view()).timer.remaining, 298);
    assert.equal(JSON.stringify(await f.view()).includes(f.cap.token), false);
  });

  test(`${backend}: a pending warning holds time and extension cancels only that stale warning`, async () => {
    const f = await party();
    await f.command({ type: 'start' }); await f.command({ type: 'advance' });
    f.setNow(380_000); await f.renew();
    const first = await f.claim('timer-warning');
    assert.equal(first.attention.endsAt, 390_000);
    assert.equal((await f.view()).timer.remaining, 30);
    f.setNow(385_000); await f.command({ type: 'extend-time' });
    const extended = await f.view();
    assert.equal(extended.attention, undefined, 'a canceled countdown ID must not authorize its later voice');
    assert.equal(extended.timer.remaining, 90);
    assert.equal(extended.timer.endsAt, 475_000);
    f.setNow(445_000); await f.renew();
    const second = await f.claim('timer-warning');
    assert.notEqual(second.attention.id, first.attention.id);
    assert.equal(second.attention.endsAt, 455_000);
    assert.equal((await f.view()).timer.remaining, 30);
  });

  test(`${backend}: a warning allows two seconds of delivery grace but omits a later stale thirty-second announcement`, async () => {
    const accepted = await party();
    await accepted.command({ type: 'start' }); await accepted.command({ type: 'advance' });
    accepted.setNow(382_000); await accepted.renew();
    const warning = await accepted.claim('timer-warning');
    assert.equal(warning.attention.endsAt, 392_000);
    assert.equal((await accepted.view()).timer.remaining, 28);

    const late = await party();
    await late.command({ type: 'start' }); await late.command({ type: 'advance' });
    for (const now of [382_001, 383_000]) {
      late.setNow(now); await late.renew();
      const before = await late.repository.get(late.master.code);
      await assert.rejects(late.claim('timer-warning'), /attention/i);
      assert.deepEqual(await late.repository.get(late.master.code), before);
    }
  });

  test(`${backend}: claims require the current display and public cue context without mutating on rejection`, async () => {
    const f = await party();
    await f.command({ type: 'start' }); await f.command({ type: 'advance' });
    const before = await f.repository.get(f.master.code);
    for (const [cue, patch] of [
      ['phase', {}], ['timer-warning', {}], ['clue', { clueId: 'not-published' }],
      ['lobby', {}], ['clue', { token: f.master.token }], ['clue', { eventKey: 'previous-phase' }],
      ['clue', { presentationSerial: -1 }], ['clue', { context: null }],
    ] as const) await assert.rejects(f.claim(cue, patch));
    assert.deepEqual(await f.repository.get(f.master.code), before);
    f.setNow(111_000);
    await assert.rejects(f.claim('timer-warning'), /display/i);
  });

  test(`${backend}: a welcome countdown is claimed once per lobby and new deal resets its scope`, async () => {
    const f = await party();
    const first = await f.claim('lobby');
    assert.equal(first.attention.cue, 'lobby');
    assert.equal(first.attention.endsAt, 110_000);
    assert.deepEqual((await f.claim('lobby')).attention, first.attention);
    await f.command({ type: 'reset' });
    const second = await f.claim('lobby');
    assert.notEqual(second.attention.id, first.attention.id);
    assert.notEqual(second.attention.eventKey, first.attention.eventKey);
  });

  test(`${backend}: expired cues remain deduped across service restart while old phase claims and stale contexts stay rejected`, async () => {
    const f = await party();
    const lobby = await f.claim('lobby');
    const lobbyView = await f.view();
    await f.command({ type: 'start' }); await f.command({ type: 'advance' });
    f.setNow(380_000); await f.renew();
    const warning = await f.claim('timer-warning');
    f.setNow(430_000); await f.renew();
    assert.deepEqual((await f.claim('timer-warning')).attention, warning.attention, 'an expired act cannot renew an already claimed warning');
    const service = new OnlineGameService({ repository: f.repository, now: () => 430_000 });
    const persisted = await f.view();
    const repeated = await service.execute('room:attention', { code: f.master.code, displayId: 'attention-tv', token: f.cap.token, eventKey: warning.attention.eventKey, cue: 'timer-warning' }) as { attention: unknown };
    assert.deepEqual(repeated.attention, warning.attention);
    const before = await f.repository.get(f.master.code);
    await assert.rejects(f.claim('lobby', { eventKey: lobby.attention.eventKey }));
    await assert.rejects(f.claim('timer-warning', { context: { gameId: lobbyView.gameId ?? null, phase: lobbyView.phase, round: lobbyView.round, actionEpoch: lobbyView.actionEpoch ?? 0 } }));
    assert.deepEqual(await f.repository.get(f.master.code), before);
    assert.equal((await f.view()).attention?.id, persisted.attention?.id);
  });
}
