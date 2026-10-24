import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = process.argv[2] || 'http://localhost:3000';
let calls = 0, checks = 0;
function check(condition, label) { checks++; assert.ok(condition, label); }
async function rpc(event, payload, requestId = randomUUID()) {
  calls++;
  const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, payload, requestId }), signal: AbortSignal.timeout(20_000) });
  return response.json();
}
async function ok(event, payload, receipt) { const reply = await rpc(event, payload, receipt); check(reply.ok, `${event} succeeds`); return reply.data; }
const context = view => ({ gameId: view.gameId ?? null, phase: view.phase, round: view.round, actionEpoch: view.actionEpoch ?? 0 });
try {
  const gm = await ok('room:create', { rehearsal: true, name: 'Scenario GM' });
  const player = await ok('room:join', { code: gm.code, name: 'Scenario guest', gender: 'any' });
  const read = token => ok('room:subscribe', { code: gm.code, ...(token ? { token } : {}) });
  const command = (token, action, observed, receipt) => rpc('room:command', { code: gm.code, token, action, context: context(observed) }, receipt);
  let lobby = await read(gm.token);
  check((await command(gm.token, { type: 'start' }, lobby)).ok, 'one-player start succeeds');
  const firstLobby = structuredClone(lobby);
  const roles = await read(gm.token);
  const receipt = randomUUID();
  const advances = await Promise.all([command(gm.token, { type: 'advance' }, roles, receipt), command(gm.token, { type: 'advance' }, roles)]);
  check(advances.filter(result => result.ok).length === 1, 'two GM tabs advance only one time');
  let act = await read(player.token);
  check(act.phase === 'investigation' && act.round === 1, 'Act 1 cannot be skipped by concurrent GM tabs');
  const winner = advances[0].ok ? advances[0] : advances[1];
  if (advances[0].ok) {
    check((await command(gm.token, { type: 'advance' }, roles, receipt)).ok, 'successful lost-response receipt replay still succeeds');
    check((await read()).round === 1, 'receipt replay cannot advance again');
  } else {
    // A fresh receipt proves stale tab context is rejected regardless of which CAS won.
    check(!(await command(gm.token, { type: 'advance' }, roles)).ok, 'stale GM context remains rejected');
  }
  check(!!winner.data && !winner.data.me, 'GM response includes no player dossier');
  const oldAct = structuredClone(act);
  check((await command(gm.token, { type: 'advance' }, act)).ok, 'refreshed GM can deliberately advance to Act 2');
  const lateAnswer = await command(player.token, { type: 'answer', optionId: oldAct.act.question.options[0].id }, oldAct);
  check(!lateAnswer.ok, 'late Act 1 answer is rejected in Act 2');
  act = await read(player.token);
  check(act.round === 2 && !act.me.answeredOptionId, 'rejected late answer does not alter current-act submission');
  const acceptedReceipt = randomUUID();
  const action = { type: 'answer', optionId: act.act.question.options[0].id };
  check((await command(player.token, action, act, acceptedReceipt)).ok, 'current Act 2 answer succeeds');
  check((await command(gm.token, { type: 'advance' }, act)).ok, 'fresh context advances Act 3');
  check((await command(player.token, action, act, acceptedReceipt)).ok, 'accepted prior-act answer receipt can be safely replayed');
  const third = await read(player.token);
  check(third.round === 3 && !third.me.answeredOptionId, 'old answer retry cannot create a new-act answer');
  check((await command(gm.token, { type: 'advance' }, third)).ok, 'open real voting');
  const voting = await read(gm.token);
  check(!voting.result && !voting.me, 'voting remains sealed and does not expose results or private dossiers');
  const finalMoves = await Promise.all([command(gm.token, { type: 'advance' }, voting), command(gm.token, { type: 'advance' }, voting)]);
  check(finalMoves.filter(result => result.ok).length === 1, 'concurrent Reveal does not reset results into lobby');
  const result = await read();
  check(result.phase === 'results' && !!result.result && !result.me, 'public result remains reviewable and public-only');
  check((await command(gm.token, { type: 'reset' }, result)).ok, 'explicit reset succeeds');
  lobby = await read(gm.token);
  check(!(await command(gm.token, { type: 'start' }, firstLobby)).ok, 'delayed first-lobby start cannot start the reset lobby');
  check(!(await command(gm.token, { type: 'kick', playerId: player.playerId }, firstLobby)).ok, 'delayed first-lobby kick cannot remove the saved seat after reset');
  check((await read()).players.length === 1 && (await read()).phase === 'lobby', 'stale lobby commands preserve the reset lobby and player');
  check((await command(gm.token, { type: 'start' }, lobby)).ok, 'next mystery starts');
  check(!(await command(player.token, { type: 'ready', ready: true }, roles)).ok, 'delayed old-deal readiness is rejected');
  check(!(await read(player.token)).me.ready, 'new character remains unread after rejected old readiness');
  for (const language of ['es', 'pt-BR']) {
    const rejected = await rpc('room:command', { code: gm.code, token: gm.token, action: { type: 'advance' }, context: context(roles), language });
    check(!rejected.ok && rejected.error && !rejected.error.startsWith('The game has moved on.'), `${language} stale-action rejection is localized`);
  }
  console.log(`Verified party timing scenarios: ${checks} checks across ${calls} HTTP requests at ${origin}.`);
  console.log('Covered simultaneous GM transitions, delayed phone answers/readiness, safe accepted-action retries, new-deal isolation, sealed results and localized stale-action feedback.');
} catch (error) { console.error(`Party scenario verification failed after ${calls} HTTP requests: ${error instanceof Error ? error.message : 'unexpected response'}`); process.exitCode = 1; }
