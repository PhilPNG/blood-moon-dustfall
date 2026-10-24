import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const origin = new URL(process.argv[2] || 'http://localhost:3001').origin;
let requests = 0;
async function call(event, payload) {
  requests++;
  const response = await fetch(origin + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, payload, requestId: crypto.randomUUID() }), signal: AbortSignal.timeout(15_000) });
  assert.ok([200, 400].includes(response.status), 'Expected room RPC response');
  return response.json();
}
async function rpc(event, payload) { const reply = await call(event, payload); assert.equal(reply.ok, true, `${event}: ${reply.error ?? ''}`); return reply.data; }
const identity = session => ({ code: session.code, token: session.token });
const view = session => rpc('room:subscribe', identity(session));
const command = (session, action) => rpc('room:command', { ...identity(session), action });
const rejected = async (session, action) => assert.equal((await call('room:command', { ...identity(session), action })).ok, false);
const choices = id => ({ 'poker-face': id, 'in-character': id, 'wild-accusation': id });
let master;
try {
  master = await rpc('room:create', { name: 'Party features QA', rehearsal: true });
  const first = await rpc('room:join', { code: master.code, name: 'Party guest one', gender: 'any' });
  const second = await rpc('room:join', { code: master.code, name: 'Party guest two', gender: 'any' });
  const publicView = language => rpc('room:subscribe', { code: master.code, language });
  assert.deepEqual((await publicView('en')).stageSettings, { distanceMode: false, musicEnabled: true, musicVolume: 25 });
  await rejected(first, { type: 'stage-settings', settings: { musicEnabled: true } });
  await command(master, { type: 'stage-settings', settings: { distanceMode: true, musicEnabled: true, musicVolume: 50 } });
  await rejected(master, { type: 'stage-settings', settings: { musicVolume: 101 } });
  const displayId = 'party-http-' + crypto.randomUUID();
  let cap = await rpc('room:display-claim', { code: master.code, displayId });
  await command(master, { type: 'preflight-test' });
  let room = await publicView('en');
  assert.equal(room.displayConnected, true); assert.equal(room.preflight.completed, false); assert.equal(room.attention.cue, 'preflight');
  const key = `${room.gameId ?? `legacy-${room.code}`}:lobby:0:preflight:${room.actionEpoch ?? 0}:${room.preflight.serial}${room.playbackEpoch ? `:clock:${room.playbackEpoch}` : ''}`;
  const playback = { eventKey: key, clipId: 'clue', kind: 'film', position: 0, playing: true };
  const early = await call('room:playback', { code: master.code, displayId, token: cap.token, sequence: 1, playback });
  assert.equal(early.ok, false, 'Screen test must respect its shared ten-second countdown');
  const releaseAt = performance.now() + Math.max(0, room.attention.endsAt - room.serverNow) + 150;
  while (performance.now() < releaseAt) {
    await delay(Math.min(2_000, Math.max(1, releaseAt - performance.now())));
    cap = await rpc('room:display-claim', { code: master.code, displayId, token: cap.token });
  }
  await rpc('room:playback', { code: master.code, displayId, token: cap.token, sequence: 2, playback: { ...playback, position: 4, playing: false } });
  assert.equal((await view(master)).preflight.completed, true);
  await command(master, { type: 'settings', settings: { rounds: 1, roundSeconds: 60 } });
  await command(master, { type: 'start' });
  await command(first, { type: 'ready', ready: true }); await command(second, { type: 'ready', ready: true });
  await command(master, { type: 'advance' });
  const phone = await view(first); const privateId = phone.me.clues[0].id;
  await rejected(master, { type: 'spotlight', evidenceId: `shared:${privateId}` });
  room = await publicView('es');
  const phaseRelease = performance.now() + Math.max(0, room.attention.endsAt - room.serverNow) + 150;
  await delay(Math.max(1, phaseRelease - performance.now()));
  const evidenceId = `case:${room.act.evidence[0].id}`;
  room = await command(master, { type: 'spotlight', evidenceId });
  assert.equal(room.attention.cue, 'spotlight'); assert.equal(room.spotlight.evidenceId, evidenceId); assert.ok(room.timer.startsAt);
  await command(master, { type: 'spotlight', evidenceId: null });
  room = await publicView('pt-BR'); assert.equal(room.spotlight, undefined); assert.equal(room.attention, undefined);
  for (const language of ['en', 'es', 'pt-BR']) {
    const audience = await publicView(language);
    assert.equal(audience.me, undefined); assert.equal(audience.isMaster, false); assert.equal(audience.players.length, 2);
    assert.ok(!JSON.stringify(audience).includes(privateId), 'Audience cannot see private clues');
    const page = await fetch(`${origin}/watch/${master.code}`); assert.equal(page.status, 200);
  }
  await command(master, { type: 'advance' });
  await command(first, { type: 'vote', playerId: second.playerId });
  room = await publicView('en'); assert.equal(room.votesCount, 1); assert.equal(room.result, undefined);
  assert.equal(room.players.some(player => 'votedFor' in player), false);
  await command(second, { type: 'vote', playerId: first.playerId });
  await command(master, { type: 'advance' });
  const before = await view(first);
  await command(master, { type: 'awards-open' });
  const awardsId = (await publicView('en')).partyAwards.id;
  await command(first, { type: 'award-vote', awardsId, choices: choices(second.playerId) });
  await rejected(first, { type: 'award-vote', awardsId, choices: choices(first.playerId) });
  room = await publicView('en'); assert.equal(room.partyAwards.submittedCount, 1); assert.equal(room.partyAwards.results, undefined);
  assert.equal((await view(second)).me.partyAwardChoices, undefined);
  await command(second, { type: 'award-vote', awardsId, choices: choices(first.playerId) });
  await command(master, { type: 'awards-reveal', awardsId });
  room = await publicView('en'); assert.equal(room.partyAwards.status, 'revealed');
  for (const result of room.partyAwards.results) assert.equal(result.winnerIds.length, 2, 'All tied winners must be preserved');
  assert.deepEqual(room.result, before.result); assert.equal((await view(first)).me.score, before.me.score);
  await command(master, { type: 'reset' });
  room = await view(first); assert.equal(room.partyAwards, undefined); assert.equal(room.preflight, undefined);
  assert.deepEqual(room.stageSettings, { distanceMode: true, musicEnabled: true, musicVolume: 50 });
  await command(master, { type: 'stage-settings', settings: { musicEnabled: false } });
  console.log(`Party features verified: setup test, safe settings, evidence spotlight, audience privacy in three languages, live sealed turnout, immutable fun ballots and tied results (${requests} RPC calls).`);
} catch (error) {
  console.error('Party feature verification failed:', error instanceof Error ? error.message : 'Unknown failure'); process.exitCode = 1;
} finally {
  if (master) await command(master, { type: 'reset' }).catch(() => {});
}
