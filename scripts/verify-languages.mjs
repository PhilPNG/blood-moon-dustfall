import assert from 'node:assert/strict';

// HTTP contract smoke test. The TV samples below are synthetic, authenticated API reports;
// this does not claim to verify a browser's video decoder or audible playback.
// Usage: node scripts/verify-languages.mjs [http://localhost:3000|https://deployment.example]
const origin = new URL(process.argv[2] || 'http://localhost:3000').origin;
const languages = ['en', 'es', 'pt-BR'];
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
  // Consume every body, including rejected calls, so keep-alive sockets do not hold the run open.
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
async function rejected(event, payload, code = 'INVALID_REQUEST') {
  const reply = await request(event, payload);
  check(!reply.ok && reply.status >= 400, `RPC ${event} should reject the operation`);
  check(reply.errorCode === code, `RPC ${event} should preserve its control error code`);
  check(typeof reply.error === 'string' && reply.error.length > 8, `RPC ${event} needs a public explanation`);
  check(reply.data === undefined, `RPC ${event} rejection must not return private data`);
  for (const secret of secrets) check(!JSON.stringify(reply).includes(secret), 'An error response exposed a credential');
  return reply;
}
const credentials = session => ({ code: session.code, token: session.token });
const view = (session, language = 'en') => rpc('room:subscribe', { ...credentials(session), language });
const publicView = (code, language = 'en') => rpc('room:subscribe', { code, language });
const command = (session, action, language = session.language || 'en') => rpc('room:command', { ...credentials(session), action, language });
function hasKey(value, key) {
  // Count-map keys are stable option/player IDs; one quiz option is literally named "secret".
  return !!value && typeof value === 'object' && (Object.hasOwn(value, key) || Object.entries(value).some(([name, item]) => !['counts', 'tallies', 'suspicions'].includes(name) && hasKey(item, key)));
}
function publicPrivacy(room, expectedPhase) {
  check(room.phase === expectedPhase, 'Public room should be in the expected phase');
  check(room.me === undefined && room.isMaster === false, 'Public viewers must have no private identity');
  for (const key of ['alignment', 'background', 'secret', 'alibi', 'masterToken', 'ticket', 'token', 'votedFor', 'previousAnswer']) check(!hasKey(room, key), `Public ${expectedPhase} view exposed forbidden field ${key}`);
  for (const secret of secrets) check(!JSON.stringify(room).includes(secret), 'Public view exposed a credential');
  if (room.act) check(!Object.hasOwn(room.act.question, 'correctOptionId') && !Object.hasOwn(room.act.question, 'explanation'), 'The open case question must not contain its answer');
  if (room.phase !== 'results') check(room.result === undefined && !hasKey(room, 'tallies'), 'Accusation totals must remain sealed until results');
}
function translated(original, localized, language, label) {
  check(typeof localized === 'string' && localized.trim().length > 8, `${label} must contain authored prose`);
  check(language === 'en' ? localized === original : localized !== original, `${label} should follow the requested language`);
  check(!/\{\{|\}\}|undefined/.test(localized), `${label} contains an unresolved placeholder`);
}
function dossier(original, localized, language, playerId) {
  check(localized.me?.playerId === playerId, 'A phone must receive only its own seat');
  const source = original.me?.role, role = localized.me?.role;
  check(source && role, 'Every real phone needs a private dossier');
  for (const key of ['characterId', 'name', 'gender', 'alignment']) check(role[key] === source[key], 'Language must preserve canonical character identity');
  for (const key of ['background', 'brief', 'secret', 'alibi', 'objective', 'roleplayTip']) translated(source[key], role[key], language, `Private dossier ${key}`);
  check(role.objectives?.length === 2 && role.relationships?.length === 2, 'Private dossiers need both missions and relationships');
  role.objectives.forEach((objective, index) => translated(source.objectives[index], objective, language, 'Private mission'));
  role.relationships.forEach((relationship, index) => {
    check(relationship.name === source.relationships[index].name, 'Relationship names must remain canonical');
    translated(source.relationships[index].detail, relationship.detail, language, 'Private relationship');
  });
}
function act(original, localized, language) {
  check(original.question.id === localized.question.id, 'Case question identity must stay stable');
  for (const key of ['title', 'narration', 'prompt']) translated(original[key], localized[key], language, `Act ${key}`);
  same(original.evidence.map(item => item.id), localized.evidence.map(item => item.id), 'Automatic evidence identities must stay stable');
  localized.evidence.forEach((item, index) => {
    translated(original.evidence[index].title, item.title, language, 'Evidence title');
    translated(original.evidence[index].text, item.text, language, 'Evidence text');
  });
  same(original.locations.map(item => item.id), localized.locations.map(item => item.id), 'Search location identities must stay stable');
  localized.locations.forEach((item, index) => {
    translated(original.locations[index].label, item.label, language, 'Location label');
    translated(original.locations[index].description, item.description, language, 'Location description');
  });
  translated(original.question.prompt, localized.question.prompt, language, 'Question prompt');
  same(original.question.options.map(item => item.id), localized.question.options.map(item => item.id), 'Answer option identities must stay stable');
  localized.question.options.forEach((item, index) => translated(original.question.options[index].text, item.text, language, 'Answer option'));
}
// The display protocol names a take using public game/phase/round identity plus interruption epochs.
function openingSample(room, position = 0.5) {
  let eventKey = `${room.gameId}:roles:0`;
  if (room.presentation?.eventKey === eventKey) eventKey += `:presentation:${room.presentation.serial}`;
  if (room.playbackEpoch) eventKey += `:clock:${room.playbackEpoch}`;
  return { eventKey, clipId: 'opening', kind: 'film', position, playing: true };
}

async function verify() {
  const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(20_000) });
  const healthBody = await healthResponse.text();
  let health;
  try { health = JSON.parse(healthBody); } catch { check(false, 'The origin returned an invalid health response'); }
  check(healthResponse.status === 200 && health?.ok, 'The origin must expose a healthy anonymous game API');
  const prepared = await rpc('room:prepare', { language: 'es' });
  check(prepared.ticket && !Object.hasOwn(prepared, 'token'), 'Preparing a phone-hosted room must issue only a claim ticket');
  secrets.push(prepared.ticket);
  check((await publicView(prepared.code)).masterReady === false, 'An unclaimed room must wait for the GM phone');
  const master = { ...await rpc('room:claim', { code: prepared.code, ticket: prepared.ticket, language: 'es' }), language: 'es' };
  cleanupMaster = master;
  secrets.push(master.token);
  check((await view(master, 'es')).isMaster, 'The claiming phone must obtain GM controls');
  await rejected('room:claim', { code: prepared.code, ticket: prepared.ticket, language: 'es' });
  const players = [];
  for (let index = 0; index < 6; index++) {
    const language = languages[index % languages.length];
    const player = await rpc('room:join', { code: master.code, name: `Language check ${index + 1}`, gender: ['man', 'woman', 'any'][index % 3], language });
    secrets.push(player.token); players.push({ ...player, language });
  }
  await command(master, { type: 'settings', settings: { rounds: 2, roundSeconds: 60 } });
  await command(master, { type: 'start' });
  const rolesPublic = await publicView(master.code);
  publicPrivacy(rolesPublic, 'roles');
  check(rolesPublic.players.length === 6 && rolesPublic.gameId, 'Six real guests must receive a game identity');
  check(new Set(rolesPublic.players.map(player => player.characterId)).size === 6, 'All six dealt characters must be unique');

  // Exercise the persisted clock over the real public API without a browser or session-token shortcut.
  const displayId = `language-tv-${crypto.randomUUID()}`;
  let capability = await rpc('room:display-claim', { code: master.code, displayId });
  check(capability.active && capability.token && capability.token !== master.token, 'An idle TV must receive a separate scoped capability');
  secrets.push(capability.token);
  const refreshCapability = async () => {
    const renewed = await rpc('room:display-claim', { code: master.code, displayId, token: capability.token });
    check(renewed.active && renewed.token === capability.token, 'The same TV must retain its scoped lease'); capability = renewed;
  };
  // Phase media waits for the real shared attention deadline; renew the TV lease while waiting.
  const releaseAt = performance.now() + Math.max(0, (rolesPublic.attention?.endsAt ?? rolesPublic.serverNow) - rolesPublic.serverNow) + 100;
  while (performance.now() < releaseAt) {
    await new Promise(resolve => setTimeout(resolve, Math.min(2000, releaseAt - performance.now())));
    await refreshCapability();
  }
  const report = (sample, sequence, token = capability.token) => rpc('room:playback', { code: master.code, displayId, token, sequence, playback: sample });
  const initialSample = openingSample(rolesPublic);
  check((await report(initialSample, 1)).accepted, 'An authenticated half-second TV sample must be accepted');
  const clock = await publicView(master.code);
  check(clock.playback?.position === 0.5 && clock.playback.playing === true && clock.playback.clipId === 'opening', 'The public room must expose the actual submitted TV clock');
  check(Number.isFinite(clock.serverNow) && Number.isFinite(clock.playback.updatedAt) && clock.serverNow >= clock.playback.updatedAt, 'TV clocks must include authoritative server timestamps');
  const clocks = await Promise.all(languages.map(language => view(players[0], language)));
  for (const phone of clocks) same(phone.playback, clock.playback, 'Every phone language must share the same TV sample');
  await rejected('room:command', { ...credentials(players[0]), action: { type: 'pause' }, language: 'pt-BR' });
  await rejected('room:command', { code: master.code, token: capability.token, action: { type: 'pause' }, language: 'es' }, 'SESSION_INVALID');
  await rejected('room:playback', { code: master.code, displayId, token: master.token, sequence: 2, playback: initialSample });
  await rejected('room:playback', { code: master.code, displayId, token: '0'.repeat(48), sequence: 2, playback: initialSample });
  await command(master, { type: 'pause' });
  const paused = await publicView(master.code);
  check(paused.timer.isPaused && paused.playback === undefined, 'Pause must retire the live TV sample');
  const pausedErrors = await Promise.all(languages.map(language => rejected('room:command', { ...credentials(players[0]), action: { type: 'ready', ready: true }, language })));
  check(pausedErrors[0].error === 'The game is paused.', 'English paused errors must remain canonical');
  check(new Set(pausedErrors.map(reply => reply.error)).size === 3, 'Paused errors must be translated independently in all three languages');
  same(pausedErrors.map(reply => reply.errorCode), ['INVALID_REQUEST', 'INVALID_REQUEST', 'INVALID_REQUEST'], 'Localization must preserve error control codes');
  await command(master, { type: 'resume' });
  const resumed = await publicView(master.code);
  check(!resumed.timer.isPaused && resumed.playback === undefined, 'Resume must wait for a fresh TV report');
  check(resumed.playbackEpoch > paused.playbackEpoch, 'Resume must advance the public playback epoch');
  await refreshCapability();
  await rejected('room:playback', { code: master.code, displayId, token: capability.token, sequence: 50, playback: initialSample });
  await rejected('room:playback', { code: master.code, displayId, token: capability.token, sequence: 50, playback: { ...openingSample(paused), playing: false } });
  const freshSample = openingSample(resumed, 0.75);
  check((await report(freshSample, 2)).accepted, 'A new-epoch sample must be accepted after a stale report is rejected');
  check((await publicView(master.code)).playback?.eventKey === freshSample.eventKey, 'The room must publish only the current TV take');

  const englishRoles = await Promise.all(players.map(player => view(player, 'en')));
  check(englishRoles.filter(phone => phone.me.role.alignment === 'culprit').length === 1, 'Exactly one private phone must receive the culprit role');
  for (let index = 0; index < players.length; index++) {
    const localized = await view(players[index], players[index].language);
    dossier(englishRoles[index], localized, players[index].language, players[index].playerId);
  }
  // Explicit language changes on the same credential must re-render the complete private file.
  for (const language of languages) dossier(englishRoles[0], await view(players[0], language), language, players[0].playerId);
  await Promise.all(players.map(player => command(player, { type: 'ready', ready: true })));
  check((await publicView(master.code)).players.every(player => player.ready), 'All real phones must be able to acknowledge their roles');
  await command(master, { type: 'advance' });

  for (let round = 1; round <= 2; round++) {
    const publicEnglish = await publicView(master.code);
    publicPrivacy(publicEnglish, 'investigation');
    check(publicEnglish.round === round && publicEnglish.act?.question, 'The GM must advance into the expected case act');
    check(publicEnglish.act.evidence.length === (round === 1 ? 3 : 9), 'The final shortened act must retain the complete essential proof chain');
    const intendedCorrect = round === 1 ? 'coil-then-blank' : 'linked-records';
    check(publicEnglish.act.question.options.some(option => option.id === intendedCorrect), 'The English evidence question must offer the intended deduction');
    const intendedWrong = publicEnglish.act.question.options.find(option => option.id !== intendedCorrect).id;
    const choices = players.map((player, index) => ({ player, optionId: index % 2 === 0 ? intendedCorrect : intendedWrong }));
    const phones = await Promise.all(players.map(player => view(player, player.language)));
    for (let index = 0; index < players.length; index++) {
      const player = players[index], phone = phones[index];
      act(publicEnglish.act, phone.act, player.language);
      const canonical = player.language === 'en' ? phone : await view(player, 'en');
      const assigned = phone.me.clues.find(clue => clue.round === round);
      const originalClue = canonical.me.clues.find(clue => clue.id === assigned?.id);
      check(assigned && originalClue, 'Each phone needs its own current-act clue');
      translated(originalClue.title, assigned.title, player.language, 'Assigned clue title');
      translated(originalClue.text, assigned.text, player.language, 'Assigned clue text');
      const locationId = phone.act.locations[index % phone.act.locations.length].id;
      const searched = await command(player, { type: 'search', locationId });
      check(searched.me.search?.locationId === locationId, 'A private search must preserve the chosen stable location');
      const searchedEnglish = player.language === 'en' ? searched : await view(player, 'en');
      translated(searchedEnglish.me.search.title, searched.me.search.title, player.language, 'Private search title');
      translated(searchedEnglish.me.search.text, searched.me.search.text, player.language, 'Private search text');
      const answered = await command(player, { type: 'answer', optionId: choices[index].optionId });
      check(answered.me.answeredOptionId === choices[index].optionId, 'Submitted answer identifiers must remain stable');
      check(!answered.me.previousAnswer || answered.me.previousAnswer.round < round, 'A current answer must not expose correctness before act close');
      await command(player, { type: 'publish-clue', clueId: assigned.id });
    }
    const beforeClose = await publicView(master.code);
    publicPrivacy(beforeClose, 'investigation');
    check(beforeClose.answerCount === 6 && beforeClose.searchCount === 6 && beforeClose.clues.length === round * 6, 'All six phones must contribute searches, answers and shared clues');
    await command(master, { type: 'advance' });
    const closed = await publicView(master.code);
    check(closed.questionResult?.round === round && closed.questionResult.correctOptionId === intendedCorrect, 'The resolved question must confirm the intended deduction only after close');
    check(closed.questionResult.counts[intendedCorrect] === 3 && closed.questionResult.counts[intendedWrong] === 3, 'Correct and incorrect submissions must both be recorded');
    for (const { player, optionId } of choices) {
      const receipt = (await view(player, player.language)).me.previousAnswer;
      check(receipt?.round === round && receipt.optionId === optionId && receipt.correct === (optionId === closed.questionResult.correctOptionId), 'A fresh phone reload must recover its own resolved answer');
    }
    for (const index of [1, 2]) for (const language of languages) {
      const recovered = await view(players[index], language);
      const receipt = recovered.me.previousAnswer;
      const sourceOption = publicEnglish.act.question.options.find(option => option.id === choices[index].optionId);
      check(receipt?.optionId === sourceOption.id && receipt.correct === (index === 2), 'Language switching must preserve correct and incorrect private receipts');
      translated(sourceOption.text, receipt.text, language, 'Reloaded previous answer');
      translated(closed.questionResult.explanation, recovered.questionResult.explanation, language, 'Closed-act explanation');
    }
    publicPrivacy(closed, round === 1 ? 'investigation' : 'voting');
  }

  const voting = await publicView(master.code);
  publicPrivacy(voting, 'voting');
  check(voting.votesCount === 0 && voting.players.every(player => player.hasVoted === false), 'Voting must begin with public participation only');
  const vote = index => command(players[index], { type: 'vote', playerId: players[(index + 1) % players.length].playerId });
  await vote(0);
  const firstVote = await publicView(master.code);
  publicPrivacy(firstVote, 'voting');
  check(firstVote.votesCount === 1 && firstVote.players.find(player => player.id === players[0].playerId).hasVoted === true, 'The first vote must update participation without showing its target');
  check(firstVote.players.filter(player => player.hasVoted).length === 1, 'Unsubmitted phones must remain visibly unvoted');
  await Promise.all(players.slice(1).map((_, index) => vote(index + 1)));
  const sealed = await publicView(master.code);
  publicPrivacy(sealed, 'voting');
  check(sealed.votesCount === 6 && sealed.players.every(player => player.hasVoted), 'All six sealed votes must update public participation');
  await rejected('room:command', { ...credentials(players[0]), language: 'es', action: { type: 'vote', playerId: players[1].playerId } });
  await command(master, { type: 'advance' });
  const result = await publicView(master.code);
  publicPrivacy(result, 'results');
  same(result.act.evidence, sealed.act.evidence, 'The complete automatic evidence collection must survive the reveal');
  check(result.result?.solution?.timeline?.length >= 6 && result.result.scores?.length === 6, 'Results must reveal a complete solution and six public score rows');
  check(Object.values(result.result.tallies).reduce((sum, count) => sum + count, 0) === 6, 'Final tallies must include every sealed vote');
  for (const language of languages) {
    const localized = await view(players[0], language);
    const solution = localized.result.solution, original = result.result.solution;
    act(result.act, localized.act, language);
    check(localized.result.culpritId === result.result.culpritId && localized.result.caught === result.result.caught, 'Translated results must preserve the verdict');
    same(localized.result.tallies, result.result.tallies, 'Translated results must preserve final accusations');
    same(localized.result.scores, result.result.scores, 'Translated results must preserve scoring');
    for (const key of ['headline', 'summary', 'method', 'motive']) translated(original[key], solution[key], language, `Solution ${key}`);
    check(solution.timeline.length === original.timeline.length, 'Translated solutions must retain the complete timeline');
    solution.timeline.forEach((entry, index) => translated(original.timeline[index].text, entry.text, language, 'Solution timeline entry'));
  }
  await command(master, { type: 'reset' });
  const reset = await publicView(master.code);
  publicPrivacy(reset, 'lobby');
  check(reset.result === undefined && reset.questionResult === undefined && reset.act === undefined && reset.clues.length === 0, 'Reset must clear the previous public case');
  for (const player of players) {
    const phone = await view(player, player.language);
    check(phone.me.role === undefined && phone.me.previousAnswer === undefined && phone.me.answeredOptionId === undefined && phone.me.clues.length === 0 && phone.me.score === 0 && phone.me.votedFor === null, 'Reset must clear private dossiers, answers, clues, votes and scores');
  }
  cleanupMaster = undefined;
  console.log(`Verified six real mixed-language phones in English, Spanish and Brazilian Portuguese; complete private files, two-act evidence/search/answer flow, translated reload receipts, authenticated TV clock and pause epochs, sealed vote participation, localized results and reset (${requests} RPC calls) at ${origin}.`);
}

try { await verify(); }
catch (error) {
  if (cleanupMaster) try { await command(cleanupMaster, { type: 'reset' }); } catch { /* Best-effort cleanup of this run's test room only. */ }
  // Assertions use safe labels only. Do not print request bodies, credentials or private role prose.
  console.error(`Language verification failed: ${error instanceof Error ? error.message : 'Unexpected HTTP failure'}`);
  process.exitCode = 1;
}
