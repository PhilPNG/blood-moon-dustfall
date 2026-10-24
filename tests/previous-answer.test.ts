import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine.js';
import { getQuestion } from '../server/story.js';

function party() {
  const engine = new GameEngine({ now: () => 100_000 });
  const master = engine.create();
  const players = Array.from({ length: 4 }, (_, i) => engine.join({ code: master.code, name: `Guest ${i}`, gender: 'any' }));
  const run = (action: unknown) => engine.command(master.code, master.token, action);
  run({ type: 'settings', settings: { rounds: 2 } });
  run({ type: 'start' }); run({ type: 'advance' });
  return { engine, master, players, run };
}

test('answer feedback becomes a private persisted receipt only after the act closes', () => {
  const { engine, master, players, run } = party();
  const question = getQuestion(1), choice = question.options.find(option => option.id === question.correctOptionId)!;
  engine.command(master.code, players[0].token, { type: 'answer', optionId: choice.id });
  assert.equal(engine.view(master.code, players[0].token).me?.previousAnswer, undefined);
  run({ type: 'advance' });
  const receipt = { round: 1, optionId: choice.id, text: choice.text, correct: true };
  assert.deepEqual(engine.view(master.code, players[0].token).me?.previousAnswer, receipt);
  assert.equal(engine.view(master.code, players[0].token).me?.answeredOptionId, undefined);
  for (const bearer of [undefined, master.token, players[1].token]) assert.equal(JSON.stringify(engine.view(master.code, bearer)).includes('previousAnswer'), false);
  const restored = new GameEngine({ now: () => 100_000 });
  restored.restoreRoom(JSON.parse(JSON.stringify(engine.exportRoom(master.code))));
  assert.deepEqual(restored.view(master.code, players[0].token).me?.previousAnswer, receipt);
  const mutated = restored.view(master.code, players[0].token);
  mutated.me!.previousAnswer!.text = 'changed in browser';
  assert.deepEqual(restored.view(master.code, players[0].token).me?.previousAnswer, receipt);
  restored.command(master.code, master.token, { type: 'reset' });
  assert.equal(restored.view(master.code, players[0].token).me?.previousAnswer, undefined);
});

test('closing the next act records incorrect feedback and clears stale feedback for an unanswered act', () => {
  const { engine, master, players, run } = party();
  const first = getQuestion(1);
  for (const player of players.slice(0, 2)) engine.command(master.code, player.token, { type: 'answer', optionId: first.correctOptionId });
  run({ type: 'advance' });
  const final = getQuestion(3), wrong = final.options.find(option => option.id !== final.correctOptionId)!;
  engine.command(master.code, players[0].token, { type: 'answer', optionId: wrong.id });
  run({ type: 'advance' });
  assert.equal(engine.view(master.code).phase, 'voting');
  assert.deepEqual(engine.view(master.code, players[0].token).me?.previousAnswer, { round: 2, optionId: wrong.id, text: wrong.text, correct: false });
  assert.equal(engine.view(master.code, players[1].token).me?.previousAnswer, undefined);
});
