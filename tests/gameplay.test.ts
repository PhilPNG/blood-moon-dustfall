import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.js';
import { CHARACTERS, entrySeal } from '../shared/characters.js';
import { ROLE_NAMES, type Action, type Gender, type Session } from '../shared/types.js';

function game(genders: Gender[] = ['any', 'any', 'any', 'any']) {
  const engine = new GameEngine();
  const master = engine.create();
  const players = genders.map((gender, index) => engine.join({ code: master.code, name: `Guest ${index + 1}`, gender }));
  const run = (action: Action, session: Session = master) => engine.command(master.code, session.token, action);
  const view = (session?: Session) => engine.view(master.code, session?.token);
  return { engine, master, players, run, view };
}

test('default twenty-seat rooms accept a full cast while an eleventh explicit gender request is rejected atomically', () => {
  const party = game(Array(10).fill('woman'));
  assert.equal(party.view().settings.maxPlayers, 20);
  assert.equal(party.view().settings.roundSeconds, 300);
  assert.throws(() => party.engine.join({ code: party.master.code, name: 'Overflow', gender: 'woman' }), /10|ten|woman|women/i);
  assert.equal(party.view().players.length, 10);
  for (let index = 0; index < 10; index++) party.engine.join({ code: party.master.code, name: `Man ${index}`, gender: 'man' });
  party.run({ type: 'start' });
  assert.equal(new Set(party.view().players.map(player => player.characterId)).size, 20);
  assert.equal(ROLE_NAMES.length, 20);
});

test('explicit preferences receive matching unique characters even when flexible guests joined first', () => {
  const party = game([...Array(10).fill('any'), ...Array(10).fill('woman')]);
  party.run({ type: 'start' });
  const roles = party.players.map(player => party.view(player).me!.role!);
  assert.equal(new Set(roles.map(role => role.characterId)).size, 20);
  assert.equal(roles.slice(10).every(role => role.gender === 'woman'), true);
  assert.equal(roles.slice(0, 10).every(role => role.gender === 'man'), true);
  assert.equal(roles.filter(role => role.alignment === 'culprit').length, 1);
});

test('new investigation actions are private, once per round, paused safely and scored after resolution', () => {
  const party = game();
  const [player, other] = party.players;
  party.run({ type: 'start' });
  assert.throws(() => party.run({ type: 'search', locationId: 'saloon' }, player), /investigation/i);
  party.run({ type: 'advance' });
  const first = party.view(player);
  assert.ok(first.act);
  assert.equal(first.act!.locations.length, 3);
  assert.equal(first.act!.question.options.length > 1, true);
  assert.equal('correctOptionId' in first.act!.question, false);
  assert.equal('explanation' in first.act!.question, false);
  assert.throws(() => party.run({ type: 'search', locationId: 'missing' }, player), /location|search|choose/i);
  party.run({ type: 'pause' });
  for (const action of [
    { type: 'search', locationId: first.act!.locations[0].id },
    { type: 'answer', optionId: first.act!.question.options[0].id },
    { type: 'suspect', playerId: other.playerId! },
  ] as Action[]) assert.throws(() => party.run(action, player), /paused/i);
  party.run({ type: 'resume' });
  party.run({ type: 'search', locationId: first.act!.locations[0].id }, player);
  const search = party.view(player).me?.search;
  assert.ok(search?.text);
  assert.equal(party.view(player).me?.score, 25);
  assert.equal(party.view().searchCount, 1);
  assert.equal(JSON.stringify(party.view()).includes(search.text), false);
  assert.equal(party.view(other).me?.search, undefined);
  assert.throws(() => party.run({ type: 'search', locationId: first.act!.locations[1].id }, player), /already|once/i);
  assert.throws(() => party.run({ type: 'answer', optionId: 'missing' }, player), /option|answer|choose/i);
  party.run({ type: 'answer', optionId: first.act!.question.options[0].id }, player);
  assert.equal(party.view(player).me?.score, 25);
  assert.equal(party.view().answerCount, 1);
  assert.equal(party.view(other).me?.answeredOptionId, undefined);
  assert.throws(() => party.run({ type: 'answer', optionId: first.act!.question.options[1].id }, player), /already|once|final/i);
  const clueId = first.me!.clues[0].id;
  party.run({ type: 'publish-clue', clueId }, player);
  party.run({ type: 'publish-clue', clueId }, player);
  assert.equal(party.view(player).me?.score, 50);
  assert.throws(() => party.run({ type: 'suspect', playerId: player.playerId! }, player), /yourself|self/i);
  assert.throws(() => party.run({ type: 'suspect', playerId: 'missing' }, player), /player|room/i);
  party.run({ type: 'suspect', playerId: other.playerId! }, player);
  assert.equal(party.view().suspicions?.[other.playerId!], 1);
  assert.equal(party.view(player).me?.suspicionId, other.playerId);
  assert.equal(JSON.stringify(party.view().players).includes('suspicionId'), false);
  party.run({ type: 'suspect', playerId: party.players[2].playerId! }, player);
  assert.equal(party.view().suspicions?.[other.playerId!] ?? 0, 0);
  party.run({ type: 'advance' });
  const next = party.view(player);
  assert.equal(next.round, 2);
  assert.equal(next.me?.search, undefined);
  assert.equal(next.me?.answeredOptionId, undefined);
  assert.equal(next.me?.suspicionId, null);
  assert.equal(next.answerCount, 0);
  assert.equal(next.searchCount, 0);
  assert.equal(Object.values(next.suspicions ?? {}).every(count => count === 0), true);
  assert.equal(next.questionResult?.round, 1);
  assert.equal(Object.values(next.questionResult!.counts).reduce((sum, count) => sum + count, 0), 1);
  const correct = next.questionResult!.correctOptionId === first.act!.question.options[0].id;
  assert.equal(next.me?.score, correct ? 150 : 50);
  party.run({ type: 'publish-clue', clueId: next.me!.clues[0].id }, player);
  assert.equal(party.view(player).me?.score, correct ? 150 : 50);
  const deferred = party.view(other).me!.clues[0];
  party.run({ type: 'publish-clue', clueId: deferred.id }, other);
  party.run({ type: 'publish-clue', clueId: deferred.id }, other);
  assert.equal(party.view(other).me?.score, 25);
});

test('short games still expose identifying evidence automatically and final votes remain sealed', () => {
  for (const rounds of [1, 2, 3, 4, 5]) {
    const party = game();
    party.run({ type: 'settings', settings: { rounds } });
    party.run({ type: 'start' });
    const culprit = party.players.find(player => party.view(player).me?.role?.alignment === 'culprit')!;
    const culpritName = party.view(culprit).me!.role!.name;
    for (let round = 1; round <= rounds; round++) party.run({ type: 'advance' });
    const final = party.view();
    assert.equal(final.round, rounds);
    assert.ok(final.act?.evidence.length);
    const seal = entrySeal(party.view(culprit).me!.role!.characterId!);
    assert.equal(final.act!.evidence.some(item => item.text.includes(culpritName)), false);
    assert.ok(final.act!.evidence.some(item => item.text.includes(seal.color)));
    assert.ok(final.act!.evidence.some(item => item.text.includes(seal.symbol)));
    assert.deepEqual(final.clues, []);
    party.run({ type: 'advance' });
    assert.equal(party.view().phase, 'voting');
    assert.equal(party.view().result, undefined);
    for (const player of party.players) party.run({ type: 'vote', playerId: player === culprit ? party.players.find(other => other !== culprit)!.playerId! : culprit.playerId! }, player);
    assert.equal('tallies' in party.view(), false);
    assert.equal('scores' in party.view(), false);
    party.run({ type: 'advance' });
    const result = party.view().result!;
    assert.equal(result.caught, true);
    assert.equal(result.solution?.summary.includes(culpritName), true);
    assert.equal(result.scores?.length, 4);
    assert.equal(result.scores?.filter(item => item.score === 200).length, 3);
    assert.equal(result.scores?.filter(item => item.correctAccusation).length, 3);
    assert.equal(result.scores?.at(-1)?.playerId, culprit.playerId);
  }
});

test('serialization preserves investigation submissions without exposing them to other viewers and legacy snapshots recover', () => {
  const party = game();
  party.run({ type: 'start' });
  party.run({ type: 'advance' });
  const first = party.view(party.players[0]);
  party.run({ type: 'search', locationId: first.act!.locations[0].id }, party.players[0]);
  party.run({ type: 'answer', optionId: first.act!.question.options[0].id }, party.players[0]);
  const restored = new GameEngine();
  restored.restoreRoom(JSON.parse(JSON.stringify(party.engine.exportRoom(party.master.code))));
  assert.deepEqual(restored.view(party.master.code, party.players[0].token).me, party.view(party.players[0]).me);
  assert.equal(restored.view(party.master.code, party.players[1].token).me?.search, undefined);
  const legacy = party.engine.exportRoom(party.master.code) as any;
  for (const player of legacy.players) {
    for (const field of ['score', 'correctAnswers', 'cluesShared', 'searches', 'search', 'answeredOptionId', 'suspicionId']) delete player[field];
  }
  delete legacy.questionResult;
  restored.restoreRoom(legacy);
  assert.equal(restored.view(party.master.code, party.players[0].token).me?.score, 0);
  assert.doesNotThrow(() => restored.command(party.master.code, party.master.token, { type: 'advance' }));
  restored.command(party.master.code, party.master.token, { type: 'reset' });
  const reset = restored.view(party.master.code, party.players[0].token);
  assert.equal(reset.me?.score, 0);
  assert.equal(reset.act, undefined);
  assert.equal(reset.questionResult, undefined);
  assert.equal(reset.me?.search, undefined);
});

test('named reservations enforce gender and preserve enough matching characters for every remaining guest', async () => {
  const { CHARACTERS } = await import('../shared/characters.js');
  const woman = CHARACTERS.find(character => character.gender === 'woman')!;
  const man = CHARACTERS.find(character => character.gender === 'man')!;
  const party = game(['any', ...Array(10).fill('woman')]);
  assert.throws(() => party.run({ type: 'set-role', playerId: party.players[0].playerId!, roleName: woman.name }), /reserved|preferences|few|either/i);
  assert.equal(party.view().players[0].roleName, undefined);
  party.run({ type: 'set-role', playerId: party.players[0].playerId!, roleName: man.name });
  assert.throws(() => party.run({ type: 'set-gender', playerId: party.players[0].playerId!, gender: 'woman' }), /matching|character|gender/i);
  assert.equal(party.view().players[0].gender, 'any');
  assert.throws(() => party.run({ type: 'set-role', playerId: party.players[1].playerId!, roleName: man.name }), /assigned|matching|gender/i);
  party.run({ type: 'set-role', playerId: party.players[1].playerId!, roleName: woman.name });
  party.run({ type: 'start' });
  assert.equal(party.view(party.players[0]).me?.role?.name, man.name);
  assert.equal(party.view(party.players[1]).me?.role?.name, woman.name);
  assert.equal(party.players.slice(1).every(player => party.view(player).me?.role?.gender === 'woman'), true);
});

test('legacy nonbinary choices remain flexible while gender edits cannot overfill a ten-character pool', () => {
  const party = game([...Array(10).fill('man'), 'nonbinary']);
  assert.throws(() => party.run({ type: 'set-gender', playerId: party.players[10].playerId!, gender: 'man' }), /10|ten|men/i);
  assert.equal(party.view().players[10].gender, 'nonbinary');
  party.run({ type: 'start' });
  assert.equal(party.view(party.players[10]).me?.role?.gender, 'woman');
});

test('the correct case answer awards one hundred once after closing and private dossier arrays are copied', () => {
  const party = game();
  party.run({ type: 'settings', settings: { rounds: 1 } });
  party.run({ type: 'start' });
  const roles = party.players.map(player => party.view(player).me!.role!);
  const culprit = roles.find(role => role.alignment === 'culprit')!;
  assert.match(culprit.secret!, /induction coil/i);
  assert.match(culprit.secret!, /Black Star/i);
  for (const role of roles) {
    assert.ok(role.background && role.secret && role.alibi && role.roleplayTip);
    assert.equal(role.objectives!.length >= 2, true);
    assert.equal(role.relationships!.length >= 2, true);
    assert.equal(JSON.stringify(party.view()).includes(role.secret!), false);
  }
  roles[0].objectives!.push('MUTATED');
  roles[0].relationships![0].detail = 'MUTATED';
  assert.equal(JSON.stringify(party.view(party.players[0])).includes('MUTATED'), false);
  party.run({ type: 'advance' });
  const question = party.view().act!.question;
  assert.equal(question.options.length <= 4, true);
  question.options.forEach((option, index) => party.run({ type: 'answer', optionId: option.id }, party.players[index]));
  assert.equal(party.players.every(player => party.view(player).me?.score === 0), true);
  party.run({ type: 'advance' });
  const scores = party.players.map(player => party.view(player).me!.score!);
  assert.equal(scores.filter(score => score === 100).length, 1);
  assert.equal(scores.reduce((sum, score) => sum + score, 0), 100);
  assert.equal(party.view().questionResult?.round, 1);
  party.run({ type: 'advance' });
  const final = party.view().result!;
  assert.equal(final.scores!.reduce((sum, score) => sum + score.correctAnswers, 0), 1);
  assert.equal(final.caught, false);
  const escaped = final.scores!.find(score => score.playerId === final.culpritId)!;
  assert.equal(escaped.score >= 200, true);
});

test('sample guests search, answer, share and suspect in every act while respecting available seats', () => {
  const party = game([]);
  party.run({ type: 'settings', settings: { maxPlayers: 4, rounds: 2 } });
  party.run({ type: 'demo-fill' });
  assert.equal(party.view().players.length, 4);
  assert.throws(() => party.run({ type: 'demo-fill' }), /full/i);
  party.run({ type: 'start' });
  assert.equal(party.view().players.every(player => player.ready), true);
  for (let round = 1; round <= 2; round++) {
    party.run({ type: 'advance' });
    const view = party.view();
    assert.equal(view.searchCount, 4);
    assert.equal(view.answerCount, 4);
    assert.equal(Object.values(view.suspicions!).reduce((sum, count) => sum + count, 0), 4);
    assert.equal(view.clues.length, round * 4);
  }
  party.run({ type: 'advance' });
  assert.equal(party.view().votesCount, 4);
  assert.equal(party.view().result, undefined);
  party.run({ type: 'advance' });
  assert.equal(party.view().result!.scores!.every(score => score.correctAnswers === 2 && score.searches === 2 && score.cluesShared === 2 && score.score >= 300), true);
});

test('online receipt replay preserves search and share awards across independently restored engine instances', async () => {
  const { OnlineGameService } = await import('../online/service.js');
  const { MemoryRoomRepository } = await import('../online/repository.js');
  const repository = new MemoryRoomRepository();
  const service = new OnlineGameService({ repository });
  const master = await service.execute('room:create', {}) as Session;
  const players: Session[] = [];
  for (let index = 0; index < 4; index++) players.push(await service.execute('room:join', { code: master.code, name: `Remote ${index}`, gender: 'any' }) as Session);
  const command = (session: Session, action: Action, requestId: string) => service.execute('room:command', { ...session, action }, { requestId });
  await command(master, { type: 'start' }, 'start');
  const room = await command(master, { type: 'advance' }, 'advance') as ReturnType<GameEngine['view']>;
  const search = { type: 'search', locationId: room.act!.locations[0].id } as const;
  const attempts = await Promise.all([command(players[0], search, 'search'), command(players[0], search, 'search')]);
  assert.equal(attempts.every(value => (value as typeof room).me?.score === 25), true);
  const playerView = await service.execute('room:subscribe', players[0]) as typeof room;
  const publish = { type: 'publish-clue', clueId: playerView.me!.clues[0].id } as const;
  await command(players[0], publish, 'share');
  await command(players[0], publish, 'share');
  await command(players[0], publish, 'share-again');
  const restarted = new OnlineGameService({ repository });
  const recovered = await restarted.execute('room:subscribe', players[0]) as typeof room;
  assert.equal(recovered.me?.score, 50);
  assert.equal(recovered.searchCount, 1);
  const publicView = await restarted.execute('room:subscribe', { code: master.code }) as typeof room;
  assert.equal(publicView.me, undefined);
  assert.equal(publicView.clues.length, 1);
  assert.equal('correctOptionId' in publicView.act!.question, false);
});

test('every dealt identity remains deducible from seal fragments until the final named solution', () => {
  const party = game([...Array(10).fill('man'), ...Array(10).fill('woman')]);
  party.run({ type: 'settings', settings: { rounds: 1 } });
  party.run({ type: 'start' });
  const dealt = party.engine.exportRoom(party.master.code);
  for (const target of dealt.players) {
    const snapshot = structuredClone(dealt);
    for (const player of snapshot.players) player.role!.alignment = player.id === target.id ? 'culprit' : 'innocent';
    const restored = new GameEngine();
    restored.restoreRoom(snapshot);
    restored.command(party.master.code, party.master.token, { type: 'advance' });
    const act = restored.view(party.master.code).act!;
    const seal = entrySeal(target.role!.characterId!);
    assert.equal(act.evidence.some(item => item.text.includes(target.role!.name)), false);
    assert.ok(act.evidence.some(item => item.text.includes(seal.color)));
    assert.ok(act.evidence.some(item => item.text.includes(seal.symbol)));
    restored.command(party.master.code, party.master.token, { type: 'advance' });
    assert.equal(restored.view(party.master.code).act!.evidence.some(item => item.text.includes(target.role!.name)), false);
    restored.command(party.master.code, party.master.token, { type: 'advance' });
    const result = restored.view(party.master.code).result!;
    assert.equal(result.culpritId, target.id);
    assert.equal(result.solution!.headline.includes(target.role!.name), true);
  }
});


test('real archetype-era ongoing snapshots reset safely with seats and master authorization preserved', () => {
  for (const phase of ['roles', 'investigation', 'voting', 'results'] as const) {
    const party = game(['man', 'woman', 'nonbinary', 'any']);
    party.run({ type: 'start' });
    party.run({ type: 'advance' });
    const old = party.engine.exportRoom(party.master.code) as any;
    old.phase = phase;
    old.round = 3;
    old.isLocked = true;
    old.isPaused = true;
    old.remainingMs = 45000;
    old.result = { culpritId: old.players[0].id, tallies: { [old.players[0].id]: 3 }, caught: true };
    old.questionResult = { round: 2, correctOptionId: 'old-answer', explanation: 'Old case', counts: {} };
    old.players.forEach((player: any, index: number) => {
      player.role = { name: ['The Doctor', 'The Banker', 'The Sheriff', 'The Outlaw'][index], gender: player.gender, alignment: index === 0 ? 'culprit' : 'innocent', brief: 'Old role', objective: 'Old objective' };
      player.assignedRole = 'The Doctor';
      player.clues = [{ id: 'legacy-clue', text: 'Obsolete secret', published: true }];
      player.votedFor = old.players[(index + 1) % 4].id;
      player.score = 350;
      player.correctAnswers = 2;
      player.searches = 1;
      player.cluesShared = 1;
      player.search = { locationId: 'old-place', title: 'Old', text: 'Old clue' };
      player.answeredOptionId = 'old-answer';
      player.suspicionId = old.players[(index + 1) % 4].id;
      player.ready = true;
    });
    const restored = new GameEngine();
    restored.restoreRoom(old);
    const view = restored.view(party.master.code, party.master.token);
    assert.equal(view.phase, 'lobby', phase);
    assert.equal(view.isMaster, true);
    assert.equal(view.players.length, 4);
    assert.deepEqual(view.players.map(player => [player.id, player.name, player.gender]), party.view().players.map(player => [player.id, player.name, player.gender]));
    assert.equal(view.round, 0);
    assert.equal(view.isLocked, false);
    assert.deepEqual(view.timer, { endsAt: null, remaining: 0, isPaused: false });
    assert.equal(view.result, undefined);
    assert.equal(view.questionResult, undefined);
    assert.deepEqual(view.clues, []);
    assert.equal(view.votesCount, 0);
    assert.equal(view.act, undefined);
    assert.equal(view.notice, 'Dustfall has been upgraded. Your seats are saved; the game master can deal the new cast.');
    const saved = restored.exportRoom(party.master.code);
    assert.equal(saved.createdAt, old.createdAt);
    assert.equal(saved.masterToken, old.masterToken);
    assert.equal(saved.notice, view.notice);
    for (const player of party.players) {
      const me = restored.view(party.master.code, player.token).me!;
      assert.equal(me.role, undefined);
      assert.deepEqual(me.clues, []);
      assert.equal(me.score, 0);
      assert.equal(me.votedFor, null);
      assert.equal(me.ready, false);
      assert.equal(me.search, undefined);
      assert.equal(me.answeredOptionId, undefined);
      assert.equal(me.suspicionId, null);
    }
    assert.ok(saved.players.every(player => player.assignedRole === undefined && player.correctAnswers === 0 && player.searches === 0 && player.cluesShared === 0));
    const reloaded = new GameEngine();
    reloaded.restoreRoom(saved);
    assert.equal(reloaded.view(party.master.code).notice, view.notice);
    reloaded.command(party.master.code, party.master.token, { type: 'start' });
    assert.equal(reloaded.view(party.master.code).notice, undefined);
    assert.ok(reloaded.view(party.master.code).players.every(player => CHARACTERS.some(character => character.id === player.characterId)));
  }
});

test('obsolete lobby reservations clear without resetting valid modern cast reservations', () => {
  const party = game();
  const saved = party.engine.exportRoom(party.master.code);
  saved.players[0].assignedRole = 'The Doctor';
  saved.players[1].assignedRole = CHARACTERS[2].name;
  const restored = new GameEngine();
  restored.restoreRoom(saved);
  assert.equal(restored.view(party.master.code).phase, 'lobby');
  assert.equal(restored.view(party.master.code).players[0].roleName, undefined);
  assert.equal(restored.view(party.master.code).players[1].roleName, CHARACTERS[2].name);
  assert.doesNotThrow(() => restored.command(party.master.code, party.master.token, { type: 'start' }));
});
