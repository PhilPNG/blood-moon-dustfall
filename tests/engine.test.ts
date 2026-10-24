import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.js';
import type { Action, Gender, Session } from '../shared/types.js';
import { CHARACTERS } from '../shared/characters.js';

function party(count = 4, options: ConstructorParameters<typeof GameEngine>[0] = {}) {
  const engine = new GameEngine(options);
  const master = engine.create({});
  const players = Array.from({ length: count }, (_, i) => engine.join({ code: master.code, name: `Player ${i + 1}`, gender: 'any' }));
  const run = (action: Action) => engine.command(master.code, master.token, action);
  const view = (session: Session = master) => engine.view(session.code, session.token);
  return { engine, master, players, run, view };
}
function toVoting(game: ReturnType<typeof party>) {
  game.run({ type: 'start' });
  game.run({ type: 'advance' });
  for (let i = 0; i < 3; i++) game.run({ type: 'advance' });
}

test('joins normalize codes and names, reject duplicate seats, and never expose tokens', () => {
  const { engine, master, players, view } = party();
  const fifth = engine.join({ code: ` ${master.code.toLowerCase()} `, name: '  Alex   Doe  ', gender: 'woman' });
  assert.equal(view(fifth).me?.playerId, fifth.playerId);
  assert.equal(view().players[4].name, 'Alex Doe');
  assert.throws(() => engine.join({ code: master.code, name: 'alex doe', gender: 'man' }), /already|taken|duplicate/i);
  assert.equal(engine.view(master.code).isMaster, false);
  assert.equal(engine.view(master.code).me, undefined);
  for (const session of [master, ...players, fifth]) assert.equal(JSON.stringify(engine.view(master.code)).includes(session.token), false);
});

test('validates malformed create, join, subscriptions and commands at runtime', () => {
  const { engine, master, players } = party();
  for (const payload of [null, [], 'create', { unexpected: true }]) assert.throws(() => engine.create(payload));
  for (const payload of [null, {}, { code: master.code, name: '', gender: 'any' }, { code: master.code, name: 'x'.repeat(25), gender: 'any' }, { code: master.code, name: 'bad\nname', gender: 'any' }, { code: master.code, name: 'Other', gender: 'invalid' }]) assert.throws(() => engine.join(payload));
  assert.throws(() => engine.view(master.code, 'forged'), /session|token|authorized/i);
  for (const action of [null, [], {}, { type: 'unknown' }, { type: 'settings', settings: null }, { type: 'lock', locked: 'yes' }]) assert.throws(() => engine.command(master.code, master.token, action));
  assert.throws(() => engine.command(master.code, players[0].token, { type: 'start' }), /master/i);
  assert.throws(() => engine.command(master.code, 'forged', { type: 'start' }), /session|token|authorized/i);
});

test('enforces room capacity, lock, minimum players and started joins', () => {
  const { engine, master, run } = party(3);
  assert.throws(() => run({ type: 'start' }), /4|four/i);
  run({ type: 'lock', locked: true });
  assert.throws(() => engine.join({ code: master.code, name: 'Four', gender: 'any' }), /lock/i);
  run({ type: 'lock', locked: false });
  run({ type: 'settings', settings: { maxPlayers: 4 } });
  engine.join({ code: master.code, name: 'Four', gender: 'any' });
  assert.throws(() => engine.join({ code: master.code, name: 'Five', gender: 'any' }), /full|capacity/i);
  run({ type: 'start' });
  assert.throws(() => engine.join({ code: master.code, name: 'Later', gender: 'any' }), /started|progress/i);
});

test('rejects invalid settings without partially changing a room', () => {
  const { run, view } = party();
  for (const settings of [{ rounds: 0 }, { rounds: 6 }, { rounds: 1.5 }, { roundSeconds: 59 }, { roundSeconds: 601 }, { maxPlayers: 21 }, { maxPlayers: 3 }, { rounds: 2, roundSeconds: NaN }]) assert.throws(() => run({ type: 'settings', settings }));
  assert.deepEqual(view().settings, { rounds: 3, roundSeconds: 300, maxPlayers: 20 });
  run({ type: 'settings', settings: { rounds: 1, roundSeconds: 60, maxPlayers: 4 } });
  assert.deepEqual(view().settings, { rounds: 1, roundSeconds: 60, maxPlayers: 4 });
});

test('assigns unique roles, one secret culprit and explicit character gender preferences', () => {
  const { players, run, view, engine, master } = party(12);
  const genders: Gender[] = ['woman', 'man', 'nonbinary'];
  for (let i = 0; i < 3; i++) run({ type: 'set-gender', playerId: players[i].playerId!, gender: genders[i] });
  const reserved = CHARACTERS.find(character => character.gender === 'woman')!;
  run({ type: 'set-role', playerId: players[0].playerId!, roleName: reserved.name });
  assert.throws(() => run({ type: 'set-role', playerId: players[1].playerId!, roleName: reserved.name }), /assigned|taken|unique/i);
  assert.throws(() => run({ type: 'set-role', playerId: players[0].playerId!, roleName: 'made up' }));
  run({ type: 'start' });
  const roles = players.map(player => view(player).me!.role!);
  assert.equal(roles[0].name, reserved.name);
  assert.equal(new Set(roles.map(role => role.name)).size, 12);
  assert.equal(roles.filter(role => role.alignment === 'culprit').length, 1);
  assert.deepEqual(roles.slice(0, 2).map(role => role.gender), genders.slice(0, 2));
  assert.ok(['woman', 'man'].includes(roles[2].gender));
  assert.equal(roles.some(role => role.gender === 'any'), false);
  assert.equal(JSON.stringify(engine.view(master.code)).includes('alignment'), false);
  assert.equal(JSON.stringify(view()).includes('alignment'), false);
  assert.equal(view(players[0]).players.some(player => 'alignment' in player), false);
  assert.throws(() => run({ type: 'set-gender', playerId: players[0].playerId!, gender: 'man' }));
});

test('ready belongs to its player during reveal and reset clears all game secrets', () => {
  const { engine, master, players, run, view } = party();
  assert.throws(() => engine.command(master.code, players[0].token, { type: 'ready', ready: true }));
  run({ type: 'start' });
  engine.command(master.code, players[0].token, { type: 'ready', ready: true });
  assert.equal(view(players[0]).me?.ready, true);
  assert.equal(view().players[0].ready, true);
  run({ type: 'reset' });
  assert.equal(view().phase, 'lobby');
  assert.equal(view().isLocked, false);
  assert.equal(view().players.length, 4);
  assert.equal(view(players[0]).me?.role, undefined);
  assert.equal(view().players[0].ready, false);
  assert.equal(view().round, 0);
  assert.equal(view().timer.endsAt, null);
  assert.deepEqual(view(players[0]).me?.clues, []);
});

test('master advances three rounds, expiry does not advance, and pause freezes actions and time', () => {
  let now = 100000;
  const game = party(4, { now: () => now });
  const { engine, master, players, run, view } = game;
  run({ type: 'start' });
  assert.equal(view().phase, 'roles');
  run({ type: 'advance' });
  assert.equal(view().round, 1);
  assert.equal(view().timer.remaining, 300);
  now += 30000; // Ten seconds gather attention, followed by twenty seconds of investigation.
  assert.equal(view().timer.remaining, 280);
  run({ type: 'pause' });
  assert.equal(view().timer.isPaused, true);
  assert.equal(view().timer.endsAt, null);
  now += 700000;
  assert.equal(view().timer.remaining, 280);
  assert.throws(() => engine.command(master.code, players[0].token, { type: 'publish-clue', clueId: view(players[0]).me!.clues[0].id }), /paused/i);
  assert.throws(() => run({ type: 'advance' }), /paused/i);
  run({ type: 'resume' });
  now += 280000;
  assert.equal(view().timer.remaining, 0);
  assert.equal(view().phase, 'investigation');
  assert.equal(view().round, 1);
  run({ type: 'advance' });
  assert.equal(view().round, 2);
  assert.equal(view().timer.remaining, 300);
  run({ type: 'advance' });
  assert.equal(view().round, 3);
  run({ type: 'advance' });
  assert.equal(view().phase, 'voting');
  assert.equal(view().timer.endsAt, null);
});

test('private clues are unique and publishable only by their owner during investigation', () => {
  const { engine, master, players, run, view } = party();
  run({ type: 'start' });
  assert.deepEqual(view(players[0]).me?.clues, []);
  run({ type: 'advance' });
  const first = view(players[0]).me!.clues[0];
  const other = view(players[1]).me!.clues[0];
  assert.notEqual(first.id, other.id);
  assert.notEqual(first.text, other.text);
  assert.deepEqual(engine.view(master.code).clues, []);
  assert.deepEqual(view().clues, []);
  assert.equal(view(players[0]).me?.clues.length, 1);
  assert.throws(() => engine.command(master.code, players[1].token, { type: 'publish-clue', clueId: first.id }));
  engine.command(master.code, players[0].token, { type: 'publish-clue', clueId: first.id });
  assert.equal(engine.view(master.code).clues[0].published, true);
  assert.equal(view(players[1]).clues[0].text, first.text);
  assert.equal(JSON.stringify(view(players[0])).includes(other.text), false);
});

test('votes are private, immutable, cannot target self, and unique culprit majority wins', () => {
  const game = party();
  const { engine, master, players, run, view } = game;
  toVoting(game);
  const culprit = players.find(player => view(player).me?.role?.alignment === 'culprit')!;
  const innocent = players.find(player => player !== culprit)!;
  assert.throws(() => engine.command(master.code, culprit.token, { type: 'vote', playerId: culprit.playerId! }), /yourself|self/i);
  assert.throws(() => engine.command(master.code, culprit.token, { type: 'vote', playerId: 'absent' }));
  engine.command(master.code, culprit.token, { type: 'vote', playerId: innocent.playerId! });
  for (const player of players.filter(player => player !== culprit)) engine.command(master.code, player.token, { type: 'vote', playerId: culprit.playerId! });
  assert.throws(() => engine.command(master.code, innocent.token, { type: 'vote', playerId: players.find(player => player !== innocent)!.playerId! }), /already|final|immutable/i);
  assert.equal(view().votesCount, 4);
  assert.equal(view().result, undefined);
  assert.equal('votedFor' in view().players[0], false);
  assert.equal(view(innocent).me?.votedFor, culprit.playerId);
  run({ type: 'advance' });
  assert.equal(view().result?.caught, true);
  assert.equal(view().result?.tallies[culprit.playerId!], 3);
  assert.equal(view().result?.culpritId, culprit.playerId);
  assert.throws(() => run({ type: 'advance' }));
});

test('a tied highest accusation lets the culprit escape', () => {
  const game = party();
  const { engine, master, players, run, view } = game;
  toVoting(game);
  const culprit = players.find(player => view(player).me?.role?.alignment === 'culprit')!;
  const others = players.filter(player => player !== culprit);
  engine.command(master.code, culprit.token, { type: 'vote', playerId: others[0].playerId! });
  engine.command(master.code, others[0].token, { type: 'vote', playerId: culprit.playerId! });
  engine.command(master.code, others[1].token, { type: 'vote', playerId: culprit.playerId! });
  engine.command(master.code, others[2].token, { type: 'vote', playerId: others[0].playerId! });
  run({ type: 'advance' });
  assert.equal(view().result?.caught, false);
});

test('presence handles multiple connections, reconnect restores the seat, and kick revokes its token', () => {
  const { engine, master, players, run, view } = party();
  engine.connect(master.code, players[0].token, 'socket-a');
  engine.connect(master.code, players[0].token, 'socket-b');
  assert.equal(view().players[0].connected, true);
  engine.disconnect('socket-a');
  assert.equal(view().players[0].connected, true);
  engine.disconnect('socket-b');
  assert.equal(view().players[0].connected, false);
  engine.connect(master.code, players[0].token, 'socket-c');
  assert.equal(view(players[0]).me?.playerId, players[0].playerId);
  assert.equal(view().players.length, 4);
  run({ type: 'kick', playerId: players[0].playerId! });
  assert.throws(() => view(players[0]), /session|token|authorized/i);
  assert.equal(view().players.length, 3);
});

test('demo players are connected, ready automatically and vote so the master can walk through', () => {
  const { engine, run, view, master } = party(0);
  run({ type: 'demo-fill' });
  assert.equal(view().players.length, 4);
  assert.equal(view().players.every(player => player.connected && /sample/i.test(player.name)), true);
  const realPlayer = engine.join({ code: master.code, name: 'Real player', gender: 'any' });
  run({ type: 'start' });
  assert.equal(view().players.filter(player => /sample/i.test(player.name)).every(player => player.ready), true);
  run({ type: 'advance' });
  assert.equal(engine.view(master.code).clues.length, 4);
  assert.equal(view(realPlayer).me?.clues[0].published, false);
  assert.equal(engine.view(master.code).clues.some(clue => clue.playerId === realPlayer.playerId), false);
  run({ type: 'advance' });
  assert.equal(engine.view(master.code).clues.length, 8);
  assert.equal(view(realPlayer).me?.clues.length, 2);
  assert.equal(view(realPlayer).me?.clues.every(clue => !clue.published), true);
  run({ type: 'advance' });
  run({ type: 'advance' });
  assert.equal(view().phase, 'voting');
  assert.equal(view().votesCount, 4);
  assert.equal(engine.view(master.code).me, undefined);
});

test('expired rooms and bounded room capacity prevent stale unbounded storage', () => {
  let now = 0;
  const engine = new GameEngine({ now: () => now, maxRooms: 2 });
  const first = engine.create({});
  engine.create({});
  assert.throws(() => engine.create({}), /capacity|busy|limit/i);
  now = 12 * 60 * 60 * 1000;
  assert.throws(() => engine.view(first.code), /expired|found/i);
  assert.doesNotThrow(() => engine.create({}));
});
