import assert from 'node:assert/strict';

// Usage: node scripts/verify-extra-minute.mjs [http://localhost:3000|https://deployment.example]
// Exercises the public HTTP contract with four real phone seats; no media generation or playback.
const origin = new URL(process.argv[2] || 'http://localhost:3000').origin;
const check = (condition, message) => assert.ok(Boolean(condition), message);
const same = (left, right, message) => check(JSON.stringify(left) === JSON.stringify(right), message);
const secrets = [];
let requests = 0;
let cleanupMaster;

async function request(event, payload, requestId = crypto.randomUUID()) {
  requests++;
  const response = await fetch(`${origin}/api/rpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, payload, requestId }), signal: AbortSignal.timeout(20_000),
  });
  // Always consume rejected responses too, releasing their keep-alive connection.
  const body = await response.text();
  let reply;
  try { reply = JSON.parse(body); } catch { check(false, `RPC ${event} returned invalid JSON`); }
  check(reply && typeof reply.ok === 'boolean', `RPC ${event} returned an invalid contract`);
  return { status: response.status, ...reply };
}
async function rpc(event, payload, requestId) {
  const reply = await request(event, payload, requestId);
  check(reply.ok && reply.status === 200, `RPC ${event} should succeed`);
  return reply.data;
}
async function rejected(payload, code = 'INVALID_REQUEST') {
  const reply = await request('room:command', payload);
  check(!reply.ok && reply.status >= 400, 'The timer command should reject this operation');
  check(reply.errorCode === code, 'Timer rejection should preserve its control error code');
  check(typeof reply.error === 'string' && reply.error.length > 8, 'Timer rejection needs a public explanation');
  check(reply.data === undefined, 'Timer rejection must not return private data');
  for (const secret of secrets) check(!JSON.stringify(reply).includes(secret), 'Timer rejection exposed a credential');
  return reply;
}
const credentials = session => ({ code: session.code, token: session.token });
const view = session => rpc('room:subscribe', credentials(session));
const publicView = code => rpc('room:subscribe', { code });
const command = (session, action, requestId) => rpc('room:command', { ...credentials(session), action }, requestId);
const extension = { type: 'extend-time' };
function unchangedCase(room) {
  const { phase, round, settings, gameId, act, clues, questionResult, answerCount, searchCount, presentation, playbackEpoch, captionLanguage, captionSerial } = room;
  return { phase, round, settings, gameId, act, clues, questionResult, answerCount, searchCount, presentation, playbackEpoch, captionLanguage, captionSerial };
}
function publicPrivacy(room) {
  check(room.me === undefined && room.isMaster === false, 'The public display must remain anonymous');
  const serialized = JSON.stringify(room);
  for (const secret of secrets) check(!serialized.includes(secret), 'The public display exposed a credential');
  check(!serialized.includes('"alignment"') && !serialized.includes('"votedFor"'), 'The public display exposed private role or vote data');
  check(!Object.hasOwn(room.act.question, 'correctOptionId'), 'An open investigation must keep its answer sealed');
}

async function verify() {
  const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(20_000) });
  const healthBody = await healthResponse.text();
  let health;
  try { health = JSON.parse(healthBody); } catch { check(false, 'The origin returned an invalid health response'); }
  check(healthResponse.status === 200 && health?.ok, 'The origin must expose a healthy game API');

  const prepared = await rpc('room:prepare', {});
  check(prepared.ticket && !Object.hasOwn(prepared, 'token'), 'Preparing a room must issue a claim ticket');
  secrets.push(prepared.ticket);
  const master = await rpc('room:claim', { code: prepared.code, ticket: prepared.ticket });
  cleanupMaster = master;
  secrets.push(master.token);
  const players = [];
  for (let index = 0; index < 4; index++) {
    const player = await rpc('room:join', { code: master.code, name: `Minute check ${index + 1}`, gender: 'any' });
    secrets.push(player.token); players.push(player);
  }
  await rejected({ ...credentials(master), action: extension });
  await command(master, { type: 'settings', settings: { rounds: 2, roundSeconds: 60 } });
  await command(master, { type: 'start' });
  await rejected({ ...credentials(master), action: extension });
  await command(master, { type: 'advance' });
  await command(master, { type: 'captions', language: 'es' });
  await command(master, { type: 'presentation', control: 'replay' });
  const phone = await view(players[0]);
  const answer = { type: 'answer', optionId: phone.act.question.options[0].id };
  const answered = await command(players[0], answer);

  const display = await rpc('room:display-claim', { code: master.code, displayId: `minute-tv-${crypto.randomUUID()}` });
  check(display.active && display.token, 'The test display must receive a scoped capability');
  secrets.push(display.token);
  await rejected({ code: master.code, action: extension }, 'SESSION_INVALID');
  await rejected({ ...credentials(players[0]), action: extension });
  await rejected({ code: master.code, token: display.token, action: extension }, 'SESSION_INVALID');

  const before = await publicView(master.code);
  const runningId = crypto.randomUUID();
  const running = await command(master, extension, runningId);
  check(!running.timer.isPaused && running.timer.endsAt === before.timer.endsAt + 60_000, 'A running extension must add exactly one minute to its deadline');
  same(unchangedCase(running), unchangedCase(before), 'Extending a running investigation must preserve the case and presentation');
  const runningRetry = await command(master, extension, runningId);
  check(runningRetry.timer.endsAt === running.timer.endsAt && runningRetry.revision === running.revision, 'A repeated running request ID must add time only once');
  const persistedRunning = await publicView(master.code);
  check(persistedRunning.timer.endsAt === running.timer.endsAt, 'A separate public poll must recover the extended deadline');
  check((await view(players[1])).timer.endsAt === running.timer.endsAt, 'A separate phone must recover the extended deadline');
  publicPrivacy(persistedRunning);
  same((await view(players[0])).me, answered.me, 'The extension must preserve private answers and scores');
  await rejected({ ...credentials(players[0]), action: answer });

  const paused = await command(master, { type: 'pause' });
  const pausedId = crypto.randomUUID();
  const extendedPaused = await command(master, extension, pausedId);
  check(extendedPaused.timer.isPaused && extendedPaused.timer.endsAt === null, 'A paused extension must keep the clock paused');
  check(extendedPaused.timer.remaining === paused.timer.remaining + 60, 'A paused extension must add one minute to stored remaining time');
  same(unchangedCase(extendedPaused), unchangedCase(paused), 'A paused extension must preserve the case and media epochs');
  const pausedRetry = await command(master, extension, pausedId);
  check(pausedRetry.revision === extendedPaused.revision, 'A repeated paused request ID must not create another room update');
  same(pausedRetry.timer, extendedPaused.timer, 'A repeated paused request ID must add time only once');
  same((await publicView(master.code)).timer, extendedPaused.timer, 'A separate display poll must recover paused remaining time');
  same((await view(players[2])).timer, extendedPaused.timer, 'A separate phone poll must recover paused remaining time');

  let capped = extendedPaused;
  let reachedCap = false;
  // The view rounds up to whole seconds: a displayed 600 can still contain a
  // fractional gap below the real cap. Continue until the server rejects it.
  for (let attempt = 0; attempt < 10; attempt++) {
    const reply = await request('room:command', { ...credentials(master), action: extension });
    if (!reply.ok) {
      check(reply.status >= 400 && reply.errorCode === 'INVALID_REQUEST', 'The full timer must reject another extension');
      check(typeof reply.error === 'string' && reply.error.length > 8 && reply.data === undefined, 'The timer cap needs a public explanation without private data');
      for (const secret of secrets) check(!JSON.stringify(reply).includes(secret), 'Timer cap rejection exposed a credential');
      reachedCap = true;
      break;
    }
    check(reply.status === 200, 'Adding toward the timer cap should succeed');
    const previous = capped;
    capped = reply.data;
    check(capped.timer.isPaused && capped.timer.endsAt === null, 'Adding toward the cap must keep the clock paused');
    check(capped.timer.remaining === Math.min(previous.timer.remaining + 60, 600), 'Added time must stop at ten minutes remaining');
  }
  check(reachedCap && capped.timer.remaining === 600, 'The timer must reach and enforce the ten-minute remaining cap');
  const errors = [];
  for (const language of ['en', 'es', 'pt-BR']) errors.push(await rejected({ ...credentials(master), action: extension, language }));
  check(new Set(errors.map(reply => reply.error)).size === 3, 'The time-cap explanation must be authored in all three languages');
  const afterRejected = await publicView(master.code);
  check(afterRejected.revision === capped.revision, 'Rejected cap extensions must not persist a room mutation');
  same(afterRejected.timer, capped.timer, 'Rejected cap extensions must preserve the paused clock');
  same(unchangedCase(afterRejected), unchangedCase(capped), 'Rejected cap extensions must preserve the case and presentation');

  await command(master, { type: 'resume' });
  const nextAct = await command(master, { type: 'advance' });
  check(nextAct.phase === 'investigation' && nextAct.round === 2, 'The GM must still be able to start the next act');
  check(nextAct.settings.roundSeconds === 60 && nextAct.timer.remaining === 60, 'The next act must use its configured minute without inherited additions');
  const lateRetry = await command(master, extension, runningId);
  check(lateRetry.timer.endsAt === nextAct.timer.endsAt && lateRetry.round === 2, 'An old extension retry must not add time to the next act');
  await command(master, { type: 'advance' });
  await rejected({ ...credentials(master), action: extension });
  await command(master, { type: 'advance' });
  await rejected({ ...credentials(master), action: extension });
  await command(master, { type: 'reset' });
  cleanupMaster = undefined;
  console.log(`Verified running and paused extra minutes, ten-minute cap, three-language cap errors, GM authority, public and phone persistence, request retries and next-act reset (${requests} RPC calls) at ${origin}.`);
}

try { await verify(); }
catch (error) {
  if (cleanupMaster) try { await command(cleanupMaster, { type: 'reset' }); } catch { /* Clean up only this run's test room. */ }
  // Assertion labels contain no request bodies, credentials or private role prose.
  console.error(`Extra-minute verification failed: ${error instanceof Error ? error.message : 'Unexpected HTTP failure'}`);
  process.exitCode = 1;
}
