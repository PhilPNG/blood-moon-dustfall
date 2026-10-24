import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { GameEngine } from '../server/engine.js';
import { OnlineGameService } from '../online/service.js';
import { D1RoomRepository, MemoryRoomRepository, type D1DatabaseBinding } from '../online/repository.js';
import { publicEvidence } from '../shared/evidence-browser.js';
import { attentionActive, attentionEventKey } from '../shared/attention.js';
import { cinematicEvent } from '../shared/cinematics.js';
import { playbackEventKey } from '../shared/media-sync.js';
import { preflightEvent } from '../shared/stage-presentation.js';
import type { PartyAwardChoices, RoomView, Session } from '../shared/types.js';

const choicesFor = (id: string): PartyAwardChoices => ({ 'poker-face': id, 'in-character': id, 'wild-accusation': id });
const context = (view: RoomView) => ({ gameId: view.gameId ?? null, phase: view.phase, round: view.round, actionEpoch: view.actionEpoch ?? 0 });

function engineParty(count = 4, rehearsal = false) {
  let now = 100_000;
  const engine = new GameEngine({ now: () => now });
  const master = engine.create({ rehearsal });
  const players = Array.from({ length: count }, (_, index) => engine.join({ code: master.code, name: `Guest ${index + 1}`, gender: 'any' }));
  const command = (action: unknown, session = master) => engine.command(master.code, session.token, action);
  const view = (session?: Session) => engine.view(master.code, session?.token);
  const results = () => {
    command({ type: 'settings', settings: { rounds: 1 } });
    command({ type: 'start' }); command({ type: 'advance' }); command({ type: 'advance' }); command({ type: 'advance' });
  };
  let sequence = 0;
  let cap = engine.claimDisplay(master.code, 'party-tv');
  const report = (position: number, playing = false, key = playbackEventKey(view(), preflightEvent(view())!.key)) => {
    cap = engine.claimDisplay(master.code, 'party-tv', cap.token);
    engine.reportPlayback(master.code, cap.displayId, cap.token, { eventKey: key, clipId: 'clue', kind: 'film', position, playing }, ++sequence);
  };
  return { engine, master, players, command, view, results, report, get cap() { return cap; }, setNow(value: number) { now = value; } };
}

test('stage preferences have safe defaults for new/legacy rooms, validate atomically and survive a new case', () => {
  const f = engineParty();
  assert.deepEqual(f.view().stageSettings, { distanceMode: false, musicEnabled: false, musicVolume: 25 });
  const legacy = f.engine.exportRoom(f.master.code); delete legacy.stageSettings;
  f.engine.restoreRoom(legacy);
  assert.deepEqual(f.view().stageSettings, { distanceMode: false, musicEnabled: false, musicVolume: 25 });
  f.command({ type: 'stage-settings', settings: { distanceMode: true, musicEnabled: true, musicVolume: 0 } });
  for (const settings of [{ musicVolume: -1 }, { musicVolume: 101 }, { musicVolume: 1.5 }, { musicVolume: NaN }, { musicVolume: '10' }, { musicEnabled: 'false' }, { distanceMode: 1 }, { musicVolume: 80, unknown: true }, null]) {
    const before = f.engine.exportRoom(f.master.code);
    assert.throws(() => f.command({ type: 'stage-settings', settings }));
    assert.deepEqual(f.engine.exportRoom(f.master.code), before);
  }
  assert.throws(() => f.command({ type: 'stage-settings', settings: { musicEnabled: false } }, f.players[0]), /game master/i);
  f.command({ type: 'start' });
  f.command({ type: 'stage-settings', settings: { musicVolume: 100 } });
  f.command({ type: 'pause' });
  f.command({ type: 'stage-settings', settings: { musicEnabled: false } });
  f.command({ type: 'reset' });
  assert.deepEqual(f.view().stageSettings, { distanceMode: true, musicEnabled: false, musicVolume: 100 });
});

test('a spotlight accepts exact public evidence IDs only, holds act time and same-card retries do not renew it', () => {
  const f = engineParty(); f.command({ type: 'start' }); f.command({ type: 'advance' });
  const evidenceId = publicEvidence(f.view())[0].key;
  assert.throws(() => f.command({ type: 'spotlight', evidenceId }), /presentation/i);
  f.setNow(111_000);
  const privateClue = f.view(f.players[0]).me!.clues[0];
  for (const invalidId of [privateClue.id, `shared:${privateClue.id}`, 'case:missing', 'dossier:secret', '', undefined]) {
    const before = f.engine.exportRoom(f.master.code);
    assert.throws(() => f.command({ type: 'spotlight', evidenceId: invalidId }));
    assert.deepEqual(f.engine.exportRoom(f.master.code), before);
  }
  f.command({ type: 'spotlight', evidenceId });
  const selected = f.view();
  assert.equal(selected.spotlight?.evidenceId, evidenceId); assert.equal(selected.attention?.cue, 'spotlight');
  assert.equal(selected.timer.remaining, 299); assert.equal(selected.timer.startsAt, 121_000);
  f.setNow(114_000); f.command({ type: 'spotlight', evidenceId });
  assert.deepEqual(f.view().spotlight, selected.spotlight); assert.deepEqual(f.view().attention, selected.attention);
  f.command({ type: 'spotlight', evidenceId: null });
  assert.equal(f.view().spotlight, undefined); assert.equal(f.view().attention, undefined);
  assert.equal(f.view().timer.remaining, 299); assert.equal(f.view().timer.endsAt, 413_000);
  assert.ok(f.view().playbackEpoch! > selected.playbackEpoch!);
  f.command({ type: 'publish-clue', clueId: privateClue.id }, f.players[0]);
  f.command({ type: 'spotlight', evidenceId: `shared:${privateClue.id}` });
  f.command({ type: 'advance' }); assert.equal(f.view().spotlight, undefined); assert.equal(f.view().attention?.cue, 'phase');
  f.command({ type: 'spotlight', evidenceId: null }); assert.equal(f.view().attention?.cue, 'phase', 'clear cannot cancel an unrelated cue');
  f.command({ type: 'reset' }); assert.equal(f.view().spotlight, undefined);
});

test('spotlight waits for native playback, supports paused timing, and never exposes unpublished dossier clues', () => {
  const f = engineParty(); f.command({ type: 'start' }); f.command({ type: 'advance' }); f.setNow(111_000);
  const cap = f.engine.claimDisplay(f.master.code, 'party-tv', f.cap.token);
  const film = cinematicEvent(f.view())!;
  f.engine.reportPlayback(f.master.code, cap.displayId, cap.token, { eventKey: playbackEventKey(f.view(), film.key), clipId: film.clipId, kind: 'film', position: 0, playing: true }, 1);
  const evidenceId = publicEvidence(f.view())[0].key;
  assert.throws(() => f.command({ type: 'spotlight', evidenceId }), /presentation/i);
  f.setNow(122_000); f.command({ type: 'pause' }); f.command({ type: 'spotlight', evidenceId });
  assert.equal(f.view().attention?.endsAt, null); assert.equal(f.view().attention?.remainingMs, 10_000);
  const remaining = f.view().timer.remaining;
  f.setNow(200_000); f.command({ type: 'spotlight', evidenceId: null });
  assert.equal(f.view().timer.remaining, remaining); assert.equal(f.view().timer.isPaused, true);
  assert.equal(f.view().timer.endsAt, null);
});

test('preflight is a new lobby-only native film identity with honest completion and active-TV status', () => {
  const f = engineParty();
  assert.equal(f.view().displayConnected, true);
  assert.throws(() => f.command({ type: 'preflight-test' }, f.players[0]), /game master/i);
  const beforePlayers = f.engine.exportRoom(f.master.code).players;
  f.command({ type: 'preflight-test' });
  assert.deepEqual(f.view().preflight, { serial: 1, completed: false });
  assert.equal(f.view().attention?.cue, 'preflight');
  const firstKey = playbackEventKey(f.view(), preflightEvent(f.view())!.key);
  f.report(4); assert.equal(f.view().preflight?.completed, false, 'a stopped report during countdown cannot certify completion');
  assert.throws(() => f.report(0, true), /presentation/i);
  f.setNow(110_000); f.report(3.499); assert.equal(f.view().preflight?.completed, false);
  f.report(3.5); assert.equal(f.view().preflight?.completed, true);
  assert.deepEqual(f.engine.exportRoom(f.master.code).players, beforePlayers);
  f.command({ type: 'preflight-test' });
  assert.deepEqual(f.view().preflight, { serial: 2, completed: false });
  assert.throws(() => f.report(4, false, firstKey), /clip or phase/i);
  f.setNow(118_001); assert.equal(f.view().displayConnected, false);
  assert.equal(JSON.stringify(f.view()).includes(f.cap.token!), false);
  f.command({ type: 'start' });
  assert.throws(() => f.command({ type: 'preflight-test' }), /lobby/i);
  f.command({ type: 'reset' }); assert.equal(f.view().preflight, undefined);
});

test('awards seal one complete immutable ballot per real player and reveal aggregate ties without changing the case', () => {
  const f = engineParty(); f.results();
  const verdict = f.view().result; const scores = f.players.map(player => f.view(player).me!.score);
  f.command({ type: 'awards-open' }); const award = f.view().partyAwards!;
  assert.deepEqual(award, { id: 1, status: 'voting', submittedCount: 0, eligibleCount: 4 });
  f.command({ type: 'awards-open' }); assert.equal(f.view().partyAwards!.id, award.id);
  for (const invalid of [choicesFor(f.players[0].playerId!), choicesFor('unknown'), { 'poker-face': f.players[1].playerId }, { ...choicesFor(f.players[1].playerId!), extra: f.players[1].playerId }, null]) {
    const before = f.engine.exportRoom(f.master.code);
    assert.throws(() => f.command({ type: 'award-vote', awardsId: award.id, choices: invalid }, f.players[0]));
    assert.deepEqual(f.engine.exportRoom(f.master.code), before);
  }
  const firstChoices = choicesFor(f.players[1].playerId!);
  f.command({ type: 'award-vote', awardsId: award.id, choices: firstChoices }, f.players[0]);
  assert.deepEqual(f.view(f.players[0]).me!.partyAwardChoices, firstChoices);
  assert.equal(f.view(f.players[1]).me!.partyAwardChoices, undefined);
  for (const view of [f.view(), f.view(f.master)]) {
    assert.equal(view.me, undefined); assert.equal(view.partyAwards!.results, undefined);
    assert.deepEqual(Object.keys(view.partyAwards!).sort(), ['eligibleCount', 'id', 'status', 'submittedCount']);
  }
  for (const invalid of [choicesFor(f.players[0].playerId!), choicesFor('unknown'), { 'poker-face': f.players[1].playerId }, { ...firstChoices, extra: f.players[1].playerId }, null]) {
    const before = f.engine.exportRoom(f.master.code);
    assert.throws(() => f.command({ type: 'award-vote', awardsId: award.id, choices: invalid }, f.players[0]));
    assert.deepEqual(f.engine.exportRoom(f.master.code), before);
  }
  assert.throws(() => f.command({ type: 'award-vote', awardsId: award.id, choices: choicesFor(f.players[2].playerId!) }, f.players[0]), /final/i);
  assert.throws(() => f.command({ type: 'award-vote', awardsId: award.id, choices: firstChoices }), /players/i);
  f.command({ type: 'award-vote', awardsId: award.id, choices: choicesFor(f.players[0].playerId!) }, f.players[1]);
  assert.equal(f.view().partyAwards!.submittedCount, 2);
  f.command({ type: 'awards-reveal', awardsId: award.id });
  assert.equal(f.view().partyAwards!.status, 'revealed');
  for (const result of f.view().partyAwards!.results!) {
    assert.deepEqual(result.winnerIds.sort(), [f.players[0].playerId!, f.players[1].playerId!].sort());
    assert.equal(result.tallies[f.players[0].playerId!], 1); assert.equal(result.tallies[f.players[1].playerId!], 1);
  }
  assert.deepEqual(f.view().result, verdict); assert.deepEqual(f.players.map(player => f.view(player).me!.score), scores);
  f.command({ type: 'awards-open' }); assert.equal(f.view().partyAwards!.id, award.id);
  assert.throws(() => f.command({ type: 'award-vote', awardsId: award.id, choices: choicesFor(f.players[2].playerId!) }, f.players[3]));
});

test('public party projections are detached copies and player/GM actions cannot cross their authority', () => {
  const f = engineParty();
  for (const action of [{ type: 'awards-open' }, { type: 'awards-reveal', awardsId: 1 }, { type: 'awards-skip', awardsId: 1 }, { type: 'spotlight', evidenceId: null }, { type: 'preflight-test' }]) {
    const before = f.engine.exportRoom(f.master.code);
    assert.throws(() => f.command(action, f.players[0]), /game master/i);
    assert.throws(() => f.engine.command(f.master.code, undefined, action), /session/i);
    assert.deepEqual(f.engine.exportRoom(f.master.code), before);
  }
  f.command({ type: 'stage-settings', settings: { musicEnabled: true } });
  f.command({ type: 'preflight-test' });
  const publicLobby = f.view(); publicLobby.stageSettings!.musicVolume = 0; publicLobby.preflight!.completed = true;
  assert.equal(f.view().stageSettings!.musicVolume, 25); assert.equal(f.view().preflight!.completed, false);
  f.results(); f.command({ type: 'awards-open' });
  const id = f.view().partyAwards!.id;
  f.command({ type: 'award-vote', awardsId: id, choices: choicesFor(f.players[1].playerId!) }, f.players[0]);
  const own = f.view(f.players[0]); own.me!.partyAwardChoices!['poker-face'] = f.players[2].playerId!;
  assert.equal(f.view(f.players[0]).me!.partyAwardChoices!['poker-face'], f.players[1].playerId!);
  f.command({ type: 'awards-reveal', awardsId: id });
  const publicResult = f.view(); publicResult.partyAwards!.results![0].winnerIds.length = 0;
  publicResult.partyAwards!.results![0].tallies[f.players[1].playerId!] = 100;
  assert.equal(f.view().partyAwards!.results![0].tallies[f.players[1].playerId!], 1);
  assert.deepEqual(f.view().partyAwards!.results![0].winnerIds, [f.players[1].playerId!]);
});

test('a preflight retires earlier lobby media and only its current live display can complete it', () => {
  const f = engineParty();
  const welcome = f.engine.claimAttention(f.master.code, f.cap.displayId, f.cap.token, { cue: 'lobby', eventKey: attentionEventKey(f.view()) });
  f.command({ type: 'preflight-test' });
  const current = f.view(); assert.ok(current.attention!.id > welcome.attention.id);
  const key = playbackEventKey(current, preflightEvent(current)!.key);
  assert.throws(() => f.engine.reportPlayback(f.master.code, f.cap.displayId, 'a'.repeat(48), { eventKey: key, clipId: 'clue', kind: 'film', position: 4, playing: false }, 1), /capability/i);
  f.setNow(110_000); f.report(4);
  assert.equal(f.view().preflight?.completed, true);
  f.command({ type: 'preflight-test' });
  f.setNow(120_000); f.report(4);
  assert.equal(f.view().preflight?.completed, true);
  assert.equal(f.view().clues.length, 0); assert.equal(f.view().votesCount, 0);
});

test('awards skip/reopen/reset retire stale ballots, require a real voter, and award no winners for zero votes', () => {
  const alone = engineParty(1, true); alone.results(); assert.throws(() => alone.command({ type: 'awards-open' }));
  const samples = engineParty(0, true); samples.command({ type: 'demo-fill' }); samples.results(); assert.throws(() => samples.command({ type: 'awards-open' }));
  const f = engineParty(1, true); f.command({ type: 'demo-fill' }); f.results();
  f.command({ type: 'awards-open' }); const oldId = f.view().partyAwards!.id;
  assert.equal(f.view().partyAwards!.eligibleCount, 1);
  const sample = f.view().players.find(player => player.isDemo)!;
  const sampleToken = f.engine.exportRoom(f.master.code).players.find(player => player.id === sample.id)!.token;
  assert.throws(() => f.command({ type: 'award-vote', awardsId: oldId, choices: choicesFor(f.players[0].playerId!) }, { code: f.master.code, token: sampleToken, playerId: sample.id }), /real/i);
  f.command({ type: 'award-vote', awardsId: oldId, choices: choicesFor(sample.id) }, f.players[0]);
  f.command({ type: 'awards-skip', awardsId: oldId }); assert.equal(f.view().partyAwards!.status, 'skipped');
  assert.equal(f.view().partyAwards!.results, undefined);
  f.command({ type: 'awards-open' }); const newId = f.view().partyAwards!.id; assert.ok(newId > oldId);
  assert.equal(f.view(f.players[0]).me!.partyAwardChoices, undefined);
  assert.throws(() => f.command({ type: 'award-vote', awardsId: oldId, choices: choicesFor(sample.id) }, f.players[0]), /ballot/i);
  assert.throws(() => f.command({ type: 'awards-reveal', awardsId: oldId }), /ballot/i);
  f.command({ type: 'awards-reveal', awardsId: newId });
  for (const result of f.view().partyAwards!.results!) assert.deepEqual(result.winnerIds, []);
  f.command({ type: 'reset' }); assert.equal(f.view().partyAwards, undefined); assert.equal(f.view(f.players[0]).me!.partyAwardChoices, undefined);
  f.results(); f.command({ type: 'awards-open' }); assert.ok(f.view().partyAwards!.id > newId);
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
  function serviceParty() {
    const database = backend === 'sqlite' ? new DatabaseSync(':memory:') : undefined;
    if (database) database.exec(readFileSync(new URL('../drizzle/0000_rooms.sql', import.meta.url), 'utf8'));
    const repository = database ? new D1RoomRepository(sqliteBinding(database)) : new MemoryRoomRepository();
    const service = new OnlineGameService({ repository, now: () => 100_000 });
    const execute = (event: string, payload: unknown, requestId?: string) => service.execute(event, payload, { requestId });
    const view = (session: Session) => execute('room:subscribe', session) as Promise<RoomView>;
    const command = (session: Session, action: unknown, observed?: RoomView, requestId?: string) => execute('room:command', { code: session.code, token: session.token, action, ...(observed ? { context: context(observed) } : {}) }, requestId) as Promise<RoomView>;
    const party = async () => {
      const master = await execute('room:create', { rehearsal: true }) as Session;
      const players: Session[] = [];
      for (let index = 0; index < 3; index++) players.push(await execute('room:join', { code: master.code, name: `Guest ${index}`, gender: 'any' }) as Session);
      await command(master, { type: 'settings', settings: { rounds: 1 } });
      await command(master, { type: 'start' });
      for (let step = 0; step < 3; step++) await command(master, { type: 'advance' });
      return { master, players };
    };
    return { database, repository, service, execute, view, command, party };
  }

  test(`${backend}: concurrent awards open and immutable ballots survive CAS/restart and accepted receipt replay`, async t => {
    const f = serviceParty(); t.after(() => f.database?.close()); const { master, players } = await f.party();
    const observed = await f.view(master);
    const opened = await Promise.all([f.command(master, { type: 'awards-open' }, observed, 'open-one'), f.command(master, { type: 'awards-open' }, observed, 'open-two')]);
    assert.equal(opened[0].partyAwards!.id, opened[1].partyAwards!.id); const awardsId = opened[0].partyAwards!.id;
    const actions = [choicesFor(players[1].playerId!), choicesFor(players[2].playerId!)].map(choices => ({ type: 'award-vote', awardsId, choices }));
    const raced = await Promise.allSettled(actions.map((action, index) => f.command(players[0], action, observed, `vote-${index}`)));
    assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await f.view(master)).partyAwards!.submittedCount, 1);
    const winnerIndex = raced[0].status === 'fulfilled' ? 0 : 1;
    const restarted = new OnlineGameService({ repository: f.repository, now: () => 100_000 });
    const restored = await restarted.execute('room:subscribe', players[0]) as RoomView;
    assert.deepEqual(restored.me!.partyAwardChoices, actions[winnerIndex].choices);
    await f.command(master, { type: 'awards-reveal', awardsId });
    const retry = await f.command(players[0], actions[winnerIndex], observed, `vote-${winnerIndex}`);
    assert.equal(retry.partyAwards!.status, 'revealed'); assert.equal(retry.partyAwards!.submittedCount, 1);
    const oldContext = await f.view(players[0]);
    await f.command(master, { type: 'reset' });
    const replay = await f.command(players[0], actions[winnerIndex], observed, `vote-${winnerIndex}`);
    assert.equal(replay.phase, 'lobby'); assert.equal(replay.partyAwards, undefined); assert.equal(replay.me!.partyAwardChoices, undefined);
    await assert.rejects(f.command(players[1], { type: 'award-vote', awardsId, choices: choicesFor(players[0].playerId!) }, oldContext), /moved on/i);
  });

  test(`${backend}: concurrent reveal/vote has one serial outcome and skipped ballot IDs cannot accept a delayed phone vote`, async t => {
    const f = serviceParty(); t.after(() => f.database?.close()); const { master, players } = await f.party();
    let observed = await f.command(master, { type: 'awards-open' }); const awardsId = observed.partyAwards!.id;
    const raced = await Promise.allSettled([
      f.command(master, { type: 'awards-reveal', awardsId }, observed, 'reveal-race'),
      f.command(players[0], { type: 'award-vote', awardsId, choices: choicesFor(players[1].playerId!) }, observed, 'ballot-race'),
    ]);
    assert.equal(raced[0].status, 'fulfilled');
    const final = await f.view(master); assert.equal(final.partyAwards!.status, 'revealed');
    const count = raced[1].status === 'fulfilled' ? 1 : 0;
    assert.equal(final.partyAwards!.submittedCount, count);
    for (const result of final.partyAwards!.results!) assert.equal(Object.values(result.tallies).reduce((a, b) => a + b, 0), count);
    // A fresh round after an explicit skip has a different ballot identity within the same result phase.
    await f.command(master, { type: 'reset' }); await f.command(master, { type: 'start' });
    for (let step = 0; step < 3; step++) await f.command(master, { type: 'advance' });
    observed = await f.command(master, { type: 'awards-open' }); const skipped = observed.partyAwards!.id;
    await f.command(master, { type: 'awards-skip', awardsId: skipped });
    const reopened = await f.command(master, { type: 'awards-open' }); assert.ok(reopened.partyAwards!.id > skipped);
    await assert.rejects(f.command(players[0], { type: 'award-vote', awardsId: skipped, choices: choicesFor(players[1].playerId!) }, observed), /ballot/i);
    assert.equal((await f.view(master)).partyAwards!.submittedCount, 0);
  });

  test(`${backend}: stage/preflight commands retain context isolation and receipts cannot create duplicate tests after reset`, async t => {
    const f = serviceParty(); t.after(() => f.database?.close());
    const master = await f.execute('room:create', { rehearsal: true }) as Session;
    const lobby = await f.view(master);
    await f.command(master, { type: 'stage-settings', settings: { distanceMode: true, musicEnabled: true, musicVolume: 60 } }, lobby, 'set-stage');
    const tests = await Promise.all([
      f.command(master, { type: 'preflight-test' }, lobby, 'preflight-a'),
      f.command(master, { type: 'preflight-test' }, lobby, 'preflight-b'),
    ]);
    assert.deepEqual(tests.map(view => view.preflight!.serial).sort(), [1, 2]);
    const latest = await f.view(master); assert.equal(latest.preflight!.serial, 2);
    const replay = await f.command(master, { type: 'preflight-test' }, lobby, 'preflight-a');
    assert.equal(replay.preflight!.serial, 2); assert.deepEqual(replay.attention, latest.attention);
    const restarted = new OnlineGameService({ repository: f.repository, now: () => 100_000 });
    const restored = await restarted.execute('room:subscribe', master) as RoomView;
    assert.deepEqual(restored.preflight, latest.preflight); assert.deepEqual(restored.stageSettings, latest.stageSettings);
    await f.command(master, { type: 'reset' }, latest);
    for (const action of [{ type: 'preflight-test' }, { type: 'stage-settings', settings: { musicEnabled: false } }, { type: 'spotlight', evidenceId: null }]) {
      await assert.rejects(f.command(master, action, lobby), /moved on/i);
    }
    const resetReplay = await f.command(master, { type: 'preflight-test' }, lobby, 'preflight-a');
    assert.equal(resetReplay.preflight, undefined); assert.equal(resetReplay.attention, undefined);
    assert.deepEqual(resetReplay.stageSettings, { distanceMode: true, musicEnabled: true, musicVolume: 60 });
  });
}
