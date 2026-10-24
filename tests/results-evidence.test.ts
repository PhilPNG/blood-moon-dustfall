import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/engine';
import { localizeRoomView } from '../server/localization';
import { publicEvidence, filterPublicEvidence } from '../shared/evidence-browser';

test('the complete public evidence collection and personal pin targets survive every game length through results', () => {
  for (const rounds of [1, 2, 3, 4, 5]) {
    const engine = new GameEngine();
    const master = engine.create();
    const players = Array.from({ length: 4 }, (_, i) => engine.join({ code: master.code, name: `Witness ${i}`, gender: 'any' }));
    const run = (action: unknown) => engine.command(master.code, master.token, action);
    run({ type: 'settings', settings: { rounds } }); run({ type: 'start' });
    for (let act = 0; act < rounds; act++) run({ type: 'advance' });
    const own = engine.view(master.code, players[0].token);
    engine.command(master.code, players[0].token, { type: 'publish-clue', clueId: own.me!.clues[0].id });
    run({ type: 'advance' });
    const voting = engine.view(master.code);
    const before = publicEvidence(voting);
    assert.ok(before.length >= 10);
    const pins = new Set([before[0].key]);
    run({ type: 'advance' });
    const restored = new GameEngine();
    restored.restoreRoom(JSON.parse(JSON.stringify(engine.exportRoom(master.code))));
    for (const token of [undefined, master.token, players[0].token]) {
      const result = restored.view(master.code, token);
      assert.equal(result.phase, 'results');
      assert.deepEqual(result.act, voting.act, `All public case evidence remains available after a ${rounds}-act game`);
      assert.deepEqual(publicEvidence(result), before);
      assert.equal(filterPublicEvidence(publicEvidence(result), 'pinned', '', pins).length, 1);
      assert.equal('correctOptionId' in result.act!.question, false);
      for (const language of ['es', 'pt-BR'] as const) {
        const localized = localizeRoomView(result, language);
        assert.deepEqual(publicEvidence(localized).map(item => item.key), before.map(item => item.key));
        assert.notEqual(localized.act!.evidence[0].text, result.act!.evidence[0].text);
      }
    }
  }
});
