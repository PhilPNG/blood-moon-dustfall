import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] || 'http://localhost:3000').origin;
let stage = 'connecting to the HTTP room service';
let requests = 0;
let checks = 0;
const credentials = [];
const recoveryReceipts = new Map();

function check(condition, message) { checks++; assert.ok(condition, message); }
function equal(actual, expected) { checks++; assert.deepEqual(actual, expected); }
function remember(session) {
  credentials.push(session);
  check(typeof session.token === 'string' && session.token.length > 20, 'Missing private session capability.');
  check(/^[A-HJ-NP-Z2-9]{12}$/.test(session.recoveryCode), 'Missing private recovery code.');
  check(session.expiresAt > Date.now(), 'Missing room expiry.');
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
async function rejected(event, payload, receipt, errorCode) {
  const reply = await call(event, payload, receipt);
  equal(reply.ok, false);
  if (errorCode) equal(reply.errorCode, errorCode);
}
const identity = session => ({ code: session.code, token: session.token });
const view = (session, clientId) => rpc('room:subscribe', { ...identity(session), ...(clientId ? { clientId } : {}) });
const command = (session, action, receipt) => rpc('room:command', { ...identity(session), action }, receipt);

function safeView(room) {
  const json = JSON.stringify(room);
  const forbidden = new Set(['token', 'masterToken', 'recoveryCode', 'recovery', 'alignment', 'secret', 'background', 'me', 'votedFor']);
  function inspect(value, path = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      // Public answer counts use authored option IDs, including the literal ID
      // "secret" in the final act. That numeric tally is not a private dossier.
      if (path !== 'questionResult.counts') check(!forbidden.has(key), 'A public or GM view exposed private fields.');
      inspect(item, path ? `${path}.${key}` : key);
    }
  }
  inspect(room);
  for (const session of credentials) {
    check(!json.includes(session.token), 'A public or GM view exposed a bearer capability.');
    check(!json.includes(session.recoveryCode), 'A public or GM view exposed a recovery code.');
  }
}

async function recoverPreservingState(session) {
  const before = await view(session, crypto.randomUUID());
  const payload = { code: session.code, kind: 'player', recoveryCode: session.recoveryCode.match(/.{1,4}/g).join(' - ').toLowerCase() };
  const receipt = crypto.randomUUID();
  const replacement = remember(await rpc('room:recover', payload, receipt));
  equal(replacement.playerId, session.playerId);
  check(replacement.token !== session.token, 'Recovery must replace the bearer capability.');
  check(replacement.recoveryCode !== session.recoveryCode, 'Recovery must replace the recovery code.');
  const after = await view(replacement, crypto.randomUUID());
  equal(after.me, before.me);
  equal(after.phase, before.phase);
  equal(after.round, before.round);
  equal(after.gameId, before.gameId);
  equal(after.players.map(player => player.id), before.players.map(player => player.id));
  equal(after.timer.endsAt, before.timer.endsAt);
  equal(after.timer.isPaused, before.timer.isPaused);
  equal(after.result, before.result);
  equal(await rpc('room:recover', payload, receipt), replacement);
  await rejected('room:subscribe', identity(session), undefined, 'SESSION_INVALID');
  await rejected('room:recover', { code: session.code, kind: 'player', recoveryCode: session.recoveryCode });
  const previousReceipt = recoveryReceipts.get(session.playerId);
  if (previousReceipt) await rejected('room:recover', previousReceipt.payload, previousReceipt.receipt, 'SESSION_INVALID');
  recoveryReceipts.set(session.playerId, { payload, receipt });
  return replacement;
}

async function main() {
  const prepared = await rpc('room:prepare', { name: 'Recovery smoke GM' });
  check(!('token' in prepared), 'A public pairing ticket must not contain GM authority.');
  const claimPayload = { code: prepared.code, ticket: prepared.ticket };
  const claimReceipt = crypto.randomUUID();
  let master = remember(await rpc('room:claim', claimPayload, claimReceipt));
  equal(master.name, 'Recovery smoke GM');
  const publicView = () => rpc('room:subscribe', { code: master.code });
  const players = [];
  const joinReceipts = [];
  for (let index = 0; index < 4; index++) {
    const payload = { code: master.code, name: `Recovery guest ${index + 1}`, gender: 'any' };
    const receipt = crypto.randomUUID();
    players.push(remember(await rpc('room:join', payload, receipt)));
    joinReceipts.push({ payload, receipt });
  }
  await command(master, { type: 'settings', settings: { maxPlayers: 4, rounds: 1, roundSeconds: 60 } });
  await rejected('room:join', { code: master.code, name: 'No spare seat', gender: 'any' });

  stage = 'independent device presence and delayed subscription closure';
  await view(players[0], 'recovery-tab-a');
  await view(players[0], 'recovery-tab-b');
  equal((await publicView()).players[0].connected, true);
  await rpc('room:unsubscribe', { ...identity(players[0]), clientId: 'recovery-tab-a' });
  equal((await publicView()).players[0].connected, true);
  equal(await rpc('room:leave', { ...identity(players[0]), clientId: 'recovery-tab-b', release: false }), { left: true });
  await view(players[0], 'recovery-tab-a');
  await view(players[0], 'recovery-tab-b');
  const away = await publicView();
  equal(away.players.length, 4);
  equal(away.players[0].connected, false);
  const returned = await view(players[0], 'recovery-tab-c');
  equal(returned.me.playerId, players[0].playerId);
  equal(returned.players[0].connected, true);

  stage = 'lobby release, target invalidation and revoked join receipts';
  await rpc('room:gm-profile', { ...identity(master), name: 'Morgan Smoke', backupPlayerId: players[3].playerId });
  await rpc('room:gm-offer', { ...identity(master), playerId: players[3].playerId });
  const released = players[3];
  const releasePayload = { ...identity(released), clientId: 'released-tab', release: true };
  const releaseReceipt = crypto.randomUUID();
  equal(await rpc('room:leave', releasePayload, releaseReceipt), { left: true });
  equal(await rpc('room:leave', releasePayload, releaseReceipt), { left: true });
  const releasedRoom = await publicView();
  equal(releasedRoom.players.length, 3);
  equal(releasedRoom.gameMaster.backupPlayerId, undefined);
  equal(releasedRoom.gameMaster.handoff, undefined);
  await rejected('room:subscribe', identity(released), undefined, 'SESSION_INVALID');
  await rejected('room:recover', { code: master.code, kind: 'player', recoveryCode: released.recoveryCode });
  await rejected('room:join', joinReceipts[3].payload, joinReceipts[3].receipt, 'SESSION_INVALID');
  players[3] = remember(await rpc('room:join', joinReceipts[3].payload));
  check(players[3].playerId !== released.playerId, 'A new guest must receive a new seat identity.');
  await command(master, { type: 'lock', locked: true });
  players[0] = await recoverPreservingState(players[0]);
  equal((await publicView()).players.length, 4);

  stage = 'assigned-character recovery in roles and a full locked room';
  await command(master, { type: 'start' });
  await command(players[0], { type: 'ready', ready: true });
  players[0] = await recoverPreservingState(players[0]);
  const assigned = await view(players[0], 'role-check');
  check(assigned.me.role.characterId && assigned.me.role.secret && assigned.me.role.alignment, 'Missing assigned private character.');
  safeView(await publicView());
  safeView(await view(master, 'gm-presence'));
  await rejected('room:leave', { ...identity(players[0]), release: true });
  for (let index = 1; index < players.length; index++) await command(players[index], { type: 'ready', ready: true });

  stage = 'investigation recovery preserving search, answer, clues, suspicion and score';
  await command(master, { type: 'advance' });
  const investigation = await view(players[0], 'investigation-before');
  await command(players[0], { type: 'publish-clue', clueId: investigation.me.clues[0].id });
  await command(players[0], { type: 'search', locationId: investigation.act.locations[0].id });
  const answerAction = { type: 'answer', optionId: investigation.act.question.options[0].id };
  const answerReceipt = crypto.randomUUID();
  const oldPlayer = players[0];
  await command(players[0], answerAction, answerReceipt);
  await command(players[0], { type: 'suspect', playerId: players[1].playerId });
  await command(master, { type: 'pause' });
  players[0] = await recoverPreservingState(players[0]);
  await rejected('room:command', { ...identity(oldPlayer), action: answerAction }, answerReceipt, 'SESSION_INVALID');
  await command(master, { type: 'resume' });
  const privateOther = await view(players[1], 'private-other');
  const visible = await publicView();
  safeView(visible);
  check(!JSON.stringify(visible).includes(privateOther.me.role.secret), 'Another guest dossier became public.');
  check(!JSON.stringify(visible).includes(privateOther.me.clues[0].text), 'An unpublished clue became public.');

  stage = 'named targeted GM handoff without losing the promoted guest character';
  const promotedPlayerBefore = (await view(players[1], 'handoff-player')).me;
  await rpc('room:gm-offer', { ...identity(master), playerId: players[1].playerId });
  equal((await publicView()).gameMaster.handoff.playerId, players[1].playerId);
  await rejected('room:gm-accept', identity(players[0]));
  const previousMaster = master;
  const acceptPayload = identity(players[1]);
  const acceptReceipt = crypto.randomUUID();
  master = remember(await rpc('room:gm-accept', acceptPayload, acceptReceipt));
  equal(await rpc('room:gm-accept', acceptPayload, acceptReceipt), master);
  equal(master.name, 'Recovery guest 2');
  equal((await view(players[1], 'promoted-player')).me, promotedPlayerBefore);
  const newGM = await view(master, 'promoted-gm');
  equal(newGM.isMaster, true);
  equal(newGM.me, undefined);
  equal(newGM.gameMaster.name, 'Recovery guest 2');
  equal(newGM.gameMaster.connected, true);
  equal(newGM.gameMaster.handoff, undefined);
  safeView(newGM);
  await rejected('room:subscribe', identity(previousMaster), undefined, 'SESSION_INVALID');
  await rejected('room:command', { ...identity(previousMaster), action: { type: 'reset' } }, undefined, 'SESSION_INVALID');
  await rejected('room:claim', claimPayload, claimReceipt, 'SESSION_INVALID');
  await rejected('room:recover', { code: master.code, kind: 'master', recoveryCode: previousMaster.recoveryCode });
  players[1] = await recoverPreservingState(players[1]);
  await rejected('room:gm-accept', acceptPayload, acceptReceipt, 'SESSION_INVALID');
  equal((await view(master, 'still-gm')).isMaster, true);

  stage = 'master phone recovery preserving the same game and replacing authority';
  const beforeMasterRecovery = await view(master, 'before-master-recovery');
  const oldMaster = master;
  const gmRecoverPayload = { code: master.code, kind: 'master', recoveryCode: master.recoveryCode };
  const gmRecoverReceipt = crypto.randomUUID();
  master = remember(await rpc('room:recover', gmRecoverPayload, gmRecoverReceipt));
  equal(await rpc('room:recover', gmRecoverPayload, gmRecoverReceipt), master);
  equal(master.name, oldMaster.name);
  const afterMasterRecovery = await view(master, 'recovered-gm');
  equal(afterMasterRecovery.gameId, beforeMasterRecovery.gameId);
  equal(afterMasterRecovery.phase, beforeMasterRecovery.phase);
  equal(afterMasterRecovery.timer.endsAt, beforeMasterRecovery.timer.endsAt);
  await rejected('room:subscribe', identity(oldMaster), undefined, 'SESSION_INVALID');
  await rejected('room:recover', gmRecoverPayload);
  const regenerated = remember(await rpc('room:recovery', identity(master)));
  equal(regenerated.token, master.token);
  check(regenerated.recoveryCode !== master.recoveryCode, 'Regenerating a private code must replace the old code.');
  master = regenerated;
  await rejected('room:recover', gmRecoverPayload, gmRecoverReceipt);

  stage = 'voting and results continuity after player and GM changes';
  await command(master, { type: 'advance' });
  const voting = await publicView();
  equal(voting.phase, 'voting');
  stage = 'collecting four final accusations after credential rotation';
  for (let index = 0; index < players.length; index++) {
    await command(players[index], { type: 'vote', playerId: players[(index + 1) % players.length].playerId });
  }
  players[0] = await recoverPreservingState(players[0]);
  stage = 'checking final accusation immutability and public privacy';
  await rejected('room:command', { ...identity(players[0]), action: { type: 'vote', playerId: players[2].playerId } });
  const sealed = await publicView();
  equal(sealed.votesCount, 4);
  equal(sealed.result, undefined);
  safeView(sealed);
  const result = await command(master, { type: 'advance' });
  stage = 'checking the final solution and four-seat result';
  equal(result.phase, 'results');
  equal(result.players.length, 4);
  equal(result.result.scores.length, 4);
  equal(Object.values(result.result.tallies).reduce((sum, count) => sum + count, 0), 4);
  check(Boolean(result.result.culpritId && result.result.solution.summary), 'The final case must remain solvable.');
  players[0] = await recoverPreservingState(players[0]);
  stage = 'checking preserved final results and public privacy';
  equal((await publicView()).result, result.result);
  safeView(await publicView());

  console.log(`Verified recovery lifecycle: ${checks} checks across ${requests} HTTP requests at ${origin}.`);
  console.log('Covered separate tabs, delayed polls, lobby release, every player phase, sealed votes, private/public safety, named GM handoff, both phone recovery paths, and revoked receipt rejection.');
}

// Assertions may contain private actual/expected values. Never print their stack,
// message or payload: a failed hosted smoke reports only its public-safe stage.
try { await main(); }
catch (cause) {
  const locations = cause instanceof Error ? [...new Set(cause.stack?.match(/verify-recovery\.mjs:\d+:\d+/g) ?? [])].join(', ') : '';
  console.error(`Recovery smoke failed during: ${stage}${locations ? ` (${locations})` : ''}. Credentials and private game data were not logged.`);
  process.exitCode = 1;
}
