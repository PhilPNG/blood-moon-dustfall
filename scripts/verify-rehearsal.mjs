import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] || 'http://localhost:3001').origin;
let stage = 'validating explicit room modes';
let requests = 0;
let checks = 0;
const credentials = [];
function check(condition, message) { checks++; assert.ok(condition, message); }
function equal(actual, expected) { checks++; assert.deepEqual(actual, expected); }
function remember(session) {
  check(typeof session.token === 'string' && session.token.length > 20, 'Missing private session capability.');
  check(/^[A-HJ-NP-Z2-9]{12}$/.test(session.recoveryCode), 'Missing private recovery capability.');
  check(Number.isSafeInteger(session.recoveryRevision) && session.recoveryRevision > 0, 'Missing ordered recovery revision.');
  credentials.push(session);
  return session;
}
async function call(event, payload, requestId = crypto.randomUUID()) {
  requests++;
  const response = await fetch(origin + '/api/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, payload, requestId }), cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  check([200, 400].includes(response.status), 'Expected an HTTP RPC response.');
  const reply = await response.json();
  check(typeof reply.ok === 'boolean', 'Incomplete RPC response.');
  return reply;
}
async function rpc(event, payload, receipt) {
  const reply = await call(event, payload, receipt);
  check(reply.ok, 'Expected successful room operation.');
  return reply.data;
}
async function rejected(event, payload, errorCode) {
  const reply = await call(event, payload);
  equal(reply.ok, false);
  if (errorCode) equal(reply.errorCode, errorCode);
}
const identity = session => ({ code: session.code, token: session.token });
const view = session => rpc('room:subscribe', { ...identity(session), clientId: 'rehearsal-http-' + (session.playerId || 'master') });
const publicView = session => rpc('room:subscribe', { code: session.code });
const command = (session, action) => rpc('room:command', { ...identity(session), action });

function publicSafety(room, rehearsal) {
  equal(room.rehearsal, rehearsal);
  equal(room.me, undefined);
  const forbidden = new Set(['token', 'masterToken', 'recoveryCode', 'recovery', 'alignment', 'secret', 'background', 'me', 'votedFor']);
  function inspect(value, path = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      // Authored option IDs are public count keys; the final act includes "secret".
      if (path !== 'questionResult.counts') check(!forbidden.has(key), 'Public view exposed private fields.');
      inspect(item, path ? `${path}.${key}` : key);
    }
  }
  inspect(room);
  const json = JSON.stringify(room);
  for (const session of credentials) {
    check(!json.includes(session.token), 'Public view exposed a bearer capability.');
    check(!json.includes(session.recoveryCode), 'Public view exposed a recovery capability.');
  }
}

async function main() {
  for (const rehearsal of ['true', 'false', 1, 0, null]) await rejected('room:create', { rehearsal });
  await rejected('room:prepare', { rehearsal: true });
  const ordinary = remember(await rpc('room:create', { name: 'Ordinary minimum QA' }));
  const ordinaryPlayers = [];
  for (let index = 0; index < 4; index++) {
    ordinaryPlayers.push(remember(await rpc('room:join', { code: ordinary.code, name: `Ordinary QA ${index + 1}`, gender: 'any', rehearsal: true })));
    if (index === 0 || index === 2) {
      await rejected('room:command', { ...identity(ordinary), rehearsal: true, action: { type: 'start', rehearsal: true } });
      publicSafety(await publicView(ordinary), false);
    }
  }
  await rejected('room:command', { ...identity(ordinary), action: { type: 'settings', settings: { rehearsal: true, rounds: 1 } } });
  await rejected('room:command', { ...identity(ordinary), action: { type: 'rehearsal', rehearsal: true } });
  await rejected('room:command', { ...identity(ordinaryPlayers[0]), action: { type: 'start', rehearsal: true } });
  equal((await publicView(ordinary)).settings.rounds, 3);
  await command(ordinary, { type: 'start' });
  const ordinaryStarted = await publicView(ordinary);
  equal(ordinaryStarted.phase, 'roles');
  equal(ordinaryStarted.players.length, 4);
  publicSafety(ordinaryStarted, false);

  stage = 'creating a genuine one-player rehearsal';
  const master = remember(await rpc('room:create', { rehearsal: true, name: 'Solo rehearsal QA' }));
  const empty = await publicView(master);
  publicSafety(empty, true);
  equal(empty.players.length, 0);
  equal(empty.settings.maxPlayers, 20);
  await rejected('room:command', { ...identity(master), action: { type: 'start' } });
  let player = remember(await rpc('room:join', { code: master.code, name: 'Solo developer', gender: 'any' }));
  await command(master, { type: 'settings', settings: { rounds: 3, roundSeconds: 60 } });
  await command(master, { type: 'start' });
  let own = await view(player);
  equal(own.phase, 'roles');
  equal(own.rehearsal, true);
  equal(own.players.length, 1);
  check(Boolean(own.me.role.characterId && own.me.role.secret), 'The real character dossier was not dealt.');
  const originalRole = own.me.role;
  const gameId = own.gameId;
  await command(player, { type: 'ready', ready: true });
  await command(master, { type: 'advance' });

  for (let round = 1; round <= 3; round++) {
    stage = `playing solo investigation act ${round}`;
    own = await view(player);
    equal(own.rehearsal, true);
    equal(own.phase, 'investigation');
    equal(own.round, round);
    equal(own.gameId, gameId);
    equal(own.me.role, originalRole);
    equal(own.me.clues.length, round);
    equal(own.me.ready, true);
    check(own.act.locations.length > 0 && own.act.question.options.length > 0, 'An actual investigation act was not available.');
    check(own.act.evidence.length >= round * 3, 'Automatic act evidence did not accumulate.');
    equal(own.act.question.correctOptionId, undefined);
    await command(player, { type: 'search', locationId: own.act.locations[0].id });
    await command(player, { type: 'answer', optionId: own.act.question.options[0].id });
    await command(player, { type: 'publish-clue', clueId: own.me.clues[round - 1].id });
    await rejected('room:command', { ...identity(player), action: { type: 'suspect', playerId: player.playerId } });
    const played = await publicView(master);
    publicSafety(played, true);
    equal(played.searchCount, 1);
    equal(played.answerCount, 1);
    equal(played.clues.length, round);
    if (round === 2) {
      stage = 'recovering a replacement phone without losing the solo act';
      await command(master, { type: 'pause' });
      const before = await view(player);
      const previous = player;
      const payload = { code: master.code, kind: 'player', recoveryCode: previous.recoveryCode };
      const receipt = crypto.randomUUID();
      player = remember(await rpc('room:recover', payload, receipt));
      equal(await rpc('room:recover', payload, receipt), player);
      const restored = await view(player);
      equal(restored.rehearsal, true);
      equal(restored.gameId, gameId);
      equal(restored.round, round);
      equal(restored.me, before.me);
      equal(restored.timer, before.timer);
      await rejected('room:subscribe', identity(previous), 'SESSION_INVALID');
      await rejected('room:recover', payload);
      await rejected('room:command', { ...identity(player), action: { type: 'publish-clue', clueId: restored.me.clues[0].id } });
      await command(master, { type: 'resume' });
    }
    await command(master, { type: 'advance' });
  }

  stage = 'revealing an empty solo ballot without inventing another guest';
  const voting = await view(player);
  equal(voting.phase, 'voting');
  equal(voting.me.role, originalRole);
  equal(voting.votesCount, 0);
  equal(voting.result, undefined);
  check(Boolean(voting.questionResult && voting.me.previousAnswer), 'Act answer feedback was not retained.');
  publicSafety(await publicView(master), true);
  await rejected('room:command', { ...identity(player), action: { type: 'vote', playerId: player.playerId } });
  const result = await command(master, { type: 'advance' });
  equal(result.phase, 'results');
  equal(result.players.length, 1);
  equal(result.result.culpritId, player.playerId);
  equal(result.result.caught, false);
  equal(result.result.tallies, { [player.playerId]: 0 });
  equal(result.result.scores.length, 1);
  check(Boolean(result.result.solution.summary), 'The real solution was not generated.');
  publicSafety(await publicView(master), true);
  await command(master, { type: 'reset' });
  const reset = await view(player);
  equal(reset.rehearsal, true);
  equal(reset.phase, 'lobby');
  equal(reset.players.length, 1);
  equal(reset.me.playerId, player.playerId);
  equal(reset.me.role, undefined);
  equal(reset.me.clues, []);
  equal(reset.me.votedFor, null);
  await command(master, { type: 'start' });
  equal((await publicView(master)).phase, 'roles');
  check((await publicView(master)).gameId !== gameId, 'Reset did not create a new case.');

  stage = 'running actual sealed voting with one sample guest';
  const botMaster = remember(await rpc('room:create', { rehearsal: true, name: 'One sample guest QA' }));
  const human = remember(await rpc('room:join', { code: botMaster.code, name: 'Voting developer', gender: 'any' }));
  await command(botMaster, { type: 'settings', settings: { rounds: 1 } });
  await command(botMaster, { type: 'demo-fill' });
  const samplePlayers = (await publicView(botMaster)).players.filter(guest => guest.isDemo);
  equal(samplePlayers.length, 4);
  for (const sample of samplePlayers.slice(1)) await command(botMaster, { type: 'kick', playerId: sample.id });
  const botLobby = await publicView(botMaster);
  equal(botLobby.players.length, 2);
  equal(botLobby.players.filter(guest => guest.isDemo).length, 1);
  await command(botMaster, { type: 'start' });
  await command(human, { type: 'ready', ready: true });
  await command(botMaster, { type: 'advance' });
  await command(botMaster, { type: 'advance' });
  const oneBotVoting = await publicView(botMaster);
  equal(oneBotVoting.phase, 'voting');
  equal(oneBotVoting.votesCount, 1);
  equal(oneBotVoting.result, undefined);
  publicSafety(oneBotVoting, true);
  await command(human, { type: 'vote', playerId: samplePlayers[0].id });
  await rejected('room:command', { ...identity(human), action: { type: 'vote', playerId: samplePlayers[0].id } });
  const allVoted = await publicView(botMaster);
  equal(allVoted.votesCount, 2);
  equal(allVoted.result, undefined);
  publicSafety(allVoted, true);
  const botResult = await command(botMaster, { type: 'advance' });
  equal(botResult.phase, 'results');
  equal(botResult.result.scores.length, 2);
  equal(Object.values(botResult.result.tallies).reduce((sum, count) => sum + count, 0), 2);
  equal(botResult.result.caught, false);
  publicSafety(await publicView(botMaster), true);

  stage = 'running a sole sample guest without forbidden self-targets';
  const soleMaster = remember(await rpc('room:create', { rehearsal: true, name: 'Sole sample QA' }));
  const leavingHuman = remember(await rpc('room:join', { code: soleMaster.code, name: 'Departing developer', gender: 'any' }));
  await command(soleMaster, { type: 'demo-fill' });
  const soleSamples = (await publicView(soleMaster)).players.filter(guest => guest.isDemo);
  equal(soleSamples.length, 4);
  for (const sample of soleSamples.slice(1)) await command(soleMaster, { type: 'kick', playerId: sample.id });
  await rpc('room:leave', { ...identity(leavingHuman), release: true });
  await rejected('room:subscribe', identity(leavingHuman), 'SESSION_INVALID');
  const soleLobby = await publicView(soleMaster);
  equal(soleLobby.players.length, 1);
  equal(soleLobby.players[0].isDemo, true);
  await command(soleMaster, { type: 'settings', settings: { rounds: 1 } });
  await command(soleMaster, { type: 'start' });
  equal((await publicView(soleMaster)).players[0].ready, true);
  await command(soleMaster, { type: 'advance' });
  const soleAct = await publicView(soleMaster);
  equal(soleAct.phase, 'investigation');
  equal(soleAct.suspicions, { [soleSamples[0].id]: 0 });
  equal(soleAct.searchCount, 1);
  equal(soleAct.answerCount, 1);
  equal(soleAct.clues.length, 1);
  publicSafety(soleAct, true);
  await command(soleMaster, { type: 'advance' });
  const soleVoting = await publicView(soleMaster);
  equal(soleVoting.phase, 'voting');
  equal(soleVoting.votesCount, 0);
  equal(soleVoting.players[0].hasVoted, false);
  equal(soleVoting.result, undefined);
  publicSafety(soleVoting, true);
  await command(soleMaster, { type: 'advance' });
  const soleResult = await publicView(soleMaster);
  equal(soleResult.phase, 'results');
  equal(soleResult.result.caught, false);
  equal(soleResult.result.tallies, { [soleSamples[0].id]: 0 });
  equal(soleResult.result.scores.length, 1);
  equal(soleResult.result.scores[0].correctAccusation, false);
  equal(soleResult.result.scores[0].searches, 1);
  equal(soleResult.result.scores[0].cluesShared, 1);
  equal(soleResult.result.scores[0].correctAnswers, 1);
  equal(soleResult.result.scores[0].score, 350);
  publicSafety(soleResult, true);

  console.log(`Verified rehearsal lifecycle: ${checks} checks across ${requests} HTTP requests at ${origin}.`);
  console.log('Covered ordinary minimums and isolation, malformed mode rejection, zero/one-player rehearsal, three real acts, phone recovery, reset persistence, empty solo ballot, sealed voting with exactly one sample guest, and sole-sample self-target prevention with preserved investigation scoring.');
}

// Assertion values may include private roles or capabilities. Report only the
// public-safe scenario and source locations, never the original error or stack.
try { await main(); }
catch (cause) {
  const locations = cause instanceof Error ? [...new Set(cause.stack?.match(/verify-rehearsal\.mjs:\d+:\d+/g) ?? [])].join(', ') : '';
  console.error(`Rehearsal smoke failed during: ${stage}${locations ? ` (${locations})` : ''}. Credentials and private game data were not logged.`);
  process.exitCode = 1;
}
