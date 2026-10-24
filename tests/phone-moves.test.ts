import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneMoves } from '../shared/phone-moves.js';
import { GameEngine } from '../server/engine.js';
import type { Clue, RoomView } from '../shared/types.js';

function room(): RoomView {
  return {
    code: 'DUST', phase: 'investigation', round: 2,
    settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 },
    players: [], isLocked: true, timer: { endsAt: null, remaining: 300, isPaused: false },
    clues: [], votesCount: 0, isMaster: false,
    act: {
      title: 'PRIVATE ACT TITLE', narration: 'PRIVATE NARRATION', prompt: 'PRIVATE PROMPT',
      evidence: [], locations: [], question: { id: 'PRIVATE QUESTION ID', prompt: 'PRIVATE QUESTION', options: [] },
    },
    me: { playerId: 'PRIVATE PLAYER ID', ready: false, votedFor: null, clues: [] },
  };
}

function clue(overrides: Partial<Clue> = {}): Clue {
  return {
    id: 'PRIVATE CLUE ID', title: 'PRIVATE CLUE TITLE', text: 'PRIVATE CLUE CONTENT',
    round: 2, playerId: 'PRIVATE PLAYER ID', playerName: 'PRIVATE PLAYER NAME', published: false,
    ...overrides,
  };
}

function party() {
  const engine = new GameEngine({ now: () => 100_000 });
  const master = engine.create();
  const players = Array.from({ length: 4 }, (_, index) => engine.join({ code: master.code, name: `Guest ${index}`, gender: 'any' }));
  const run = (action: unknown) => engine.command(master.code, master.token, action);
  run({ type: 'start' });
  run({ type: 'advance' });
  const view = () => engine.view(master.code, players[0].token);
  const play = (action: unknown) => engine.command(master.code, players[0].token, action);
  return { engine, master, players, run, view, play };
}

test('actual player state completes each move incrementally and preserves completion while paused or disconnected', () => {
  const { view, play, run } = party();
  assert.deepEqual(phoneMoves(view()), {
    done: 0, total: 3, items: [
      { id: 'search', status: 'todo', completed: 0, total: 1 },
      { id: 'share', status: 'todo', completed: 0, total: 1 },
      { id: 'answer', status: 'todo', completed: 0, total: 1 },
    ],
  });
  play({ type: 'search', locationId: view().act!.locations[0].id });
  assert.deepEqual(phoneMoves(view()), {
    done: 1, total: 3, items: [
      { id: 'search', status: 'done', completed: 1, total: 1 },
      { id: 'share', status: 'todo', completed: 0, total: 1 },
      { id: 'answer', status: 'todo', completed: 0, total: 1 },
    ],
  });
  play({ type: 'publish-clue', clueId: view().me!.clues[0].id });
  assert.deepEqual(phoneMoves(view()), {
    done: 2, total: 3, items: [
      { id: 'search', status: 'done', completed: 1, total: 1 },
      { id: 'share', status: 'done', completed: 1, total: 1 },
      { id: 'answer', status: 'todo', completed: 0, total: 1 },
    ],
  });
  play({ type: 'answer', optionId: view().act!.question.options[0].id });
  const completed = {
    done: 3, total: 3, items: [
      { id: 'search', status: 'done', completed: 1, total: 1 },
      { id: 'share', status: 'done', completed: 1, total: 1 },
      { id: 'answer', status: 'done', completed: 1, total: 1 },
    ],
  };
  assert.deepEqual(phoneMoves(view()), completed);
  run({ type: 'pause' });
  const paused = view();
  assert.equal(paused.timer.isPaused, true);
  assert.equal(paused.players.every(player => !player.connected), true);
  assert.deepEqual(phoneMoves(paused), completed);
});

test('a new act starts at zero despite retained published clues and a previous answer receipt', () => {
  const { view, play, run } = party();
  play({ type: 'search', locationId: view().act!.locations[0].id });
  play({ type: 'publish-clue', clueId: view().me!.clues[0].id });
  play({ type: 'answer', optionId: view().act!.question.options[0].id });
  run({ type: 'advance' });
  const next = view();
  assert.equal(next.round, 2);
  assert.ok(next.me!.previousAnswer);
  assert.equal(next.me!.clues.filter(value => value.published).length, 1);
  assert.deepEqual(phoneMoves(next), {
    done: 0, total: 3, items: [
      { id: 'search', status: 'todo', completed: 0, total: 1 },
      { id: 'share', status: 'todo', completed: 0, total: 1 },
      { id: 'answer', status: 'todo', completed: 0, total: 1 },
    ],
  });
});

test('missing assignments wait without completing the share move', () => {
  const view = room();
  assert.deepEqual(phoneMoves(view), {
    done: 0, total: 3, items: [
      { id: 'search', status: 'todo', completed: 0, total: 1 },
      { id: 'share', status: 'waiting', completed: 0, total: 0 },
      { id: 'answer', status: 'todo', completed: 0, total: 1 },
    ],
  });
  view.me!.clues = [clue({ round: 1, published: true }), clue({ playerId: 'another-player', published: true })];
  view.clues = [clue({ published: true })];
  assert.deepEqual(phoneMoves(view)?.items[1], { id: 'share', status: 'waiting', completed: 0, total: 0 });
});

test('the checklist stays hidden in every other phase and without an act or private player snapshot', () => {
  for (const phase of ['lobby', 'roles', 'voting', 'results'] as const) {
    assert.equal(phoneMoves({ ...room(), phase }), null);
  }
  assert.equal(phoneMoves({ ...room(), act: undefined }), null);
  assert.equal(phoneMoves({ ...room(), me: undefined }), null);
  const { engine, master } = party();
  assert.equal(phoneMoves(engine.view(master.code)), null);
  assert.equal(phoneMoves(engine.view(master.code, master.token)), null);
});

test('sharing counts only unique current-act clues owned by the private player and literal publication', () => {
  const view = room();
  view.me!.clues = [
    clue({ id: 'a', playerId: 'another-player', published: true }),
    clue({ id: 'a', round: 1, published: true }),
    clue({ id: 'a', published: true }),
    clue({ id: 'a', published: true }),
    clue({ id: 'b' }), clue({ id: 'b' }),
    clue({ id: 'c', published: 'true' as unknown as boolean }),
    clue({ id: 'future', round: 3, published: true }),
  ];
  view.clues = [clue({ id: 'b', published: true }), clue({ id: 'public-only', published: true })];
  assert.deepEqual(phoneMoves(view), {
    done: 0, total: 3, items: [
      { id: 'search', status: 'todo', completed: 0, total: 1 },
      { id: 'share', status: 'todo', completed: 1, total: 3 },
      { id: 'answer', status: 'todo', completed: 0, total: 1 },
    ],
  });
  for (const assigned of view.me!.clues) assigned.published = true;
  assert.deepEqual(phoneMoves(view)?.items[1], { id: 'share', status: 'done', completed: 3, total: 3 });
  assert.equal(phoneMoves(view)?.done, 1);
});

test('an explicitly defined answer counts as locked even when its ID is an empty string', () => {
  const view = room();
  view.me!.answeredOptionId = '';
  assert.deepEqual(phoneMoves(view)?.items[2], { id: 'answer', status: 'done', completed: 1, total: 1 });
  assert.equal(phoneMoves(view)?.done, 1);
  view.me!.answeredOptionId = undefined;
  assert.deepEqual(phoneMoves(view)?.items[2], { id: 'answer', status: 'todo', completed: 0, total: 1 });
});

test('the projection contains only move identities and counts without private prose or input mutations', () => {
  const view = room();
  view.me!.clues = [clue()];
  view.me!.search = { locationId: 'PRIVATE SEARCH ID', title: 'PRIVATE SEARCH TITLE', text: 'PRIVATE SEARCH TEXT' };
  view.me!.answeredOptionId = 'PRIVATE ANSWER CHOICE';
  view.me!.role = { name: 'PRIVATE ROLE', gender: 'any', alignment: 'culprit', brief: 'PRIVATE BRIEF', objective: 'PRIVATE OBJECTIVE', secret: 'PRIVATE SECRET' };
  view.me!.previousAnswer = { round: 1, optionId: 'PRIVATE OLD CHOICE', text: 'PRIVATE OLD ANSWER', correct: true };
  view.questionResult = { round: 1, correctOptionId: 'PRIVATE CORRECT CHOICE', explanation: 'PRIVATE EXPLANATION', counts: {} };
  const before = structuredClone(view);
  function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  freeze(view);
  const projection = phoneMoves(view);
  assert.deepEqual(projection, {
    done: 2, total: 3, items: [
      { id: 'search', status: 'done', completed: 1, total: 1 },
      { id: 'share', status: 'todo', completed: 0, total: 1 },
      { id: 'answer', status: 'done', completed: 1, total: 1 },
    ],
  });
  assert.doesNotMatch(JSON.stringify(projection), /PRIVATE|culprit|correct|role|player|title|text/);
  assert.deepEqual(view, before);
  projection!.items[0].completed = 99;
  assert.equal(phoneMoves(view)?.items[0].completed, 1);
});
