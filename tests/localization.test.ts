import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, entrySeal } from '../shared/characters.js';
import { LANGUAGES, normalizeLanguage, type Language } from '../shared/locale.js';
import { localizeRoomView, localizeStoryText, storyLocalizationCoverage } from '../server/localization.js';
import { getAct, getQuestion, makeClue, privateDossier, searchClue, solution } from '../server/story.js';
import { GameEngine } from '../server/engine.js';
import type { RoomView, Role } from '../shared/types.js';

const languages = ['es', 'pt-BR'] as const;
const narrativeFields = new Set(['background', 'secret', 'alibi', 'roleplayTip', 'title', 'text', 'label', 'description', 'prompt', 'narration', 'explanation', 'headline', 'summary', 'method', 'motive', 'brief', 'objective', 'notice', 'detail']);
function translateNarrative<T>(value: T, language: Language, field = ''): T {
  if (typeof value === 'string') return (narrativeFields.has(field) || field === 'objectives' || (field === 'time' && !/\d/.test(value)) ? localizeStoryText(value, language) : value) as T;
  if (Array.isArray(value)) return value.map(item => translateNarrative(item, language, field)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, translateNarrative(item, language, key)])) as T;
  return value;
}
function assertAllNarrativeChanged(original: unknown, translated: unknown, field = '') {
  if (typeof original === 'string') {
    if (narrativeFields.has(field) || field === 'objectives' || (field === 'time' && !/\d/.test(original))) {
      assert.notEqual(translated, original, `English fallback in ${field}: ${original}`);
      assert.doesNotMatch(String(translated), /\{\{|\}\}|undefined/);
    } else assert.equal(translated, original, `Stable field ${field} changed`);
    return;
  }
  if (Array.isArray(original)) {
    assert.ok(Array.isArray(translated)); assert.equal(original.length, translated.length);
    original.forEach((item, index) => assertAllNarrativeChanged(item, translated[index], field));
    return;
  }
  if (original && typeof original === 'object') {
    assert.deepEqual(Object.keys(translated as object).sort(), Object.keys(original).sort(), 'Localization must neither add hidden data nor drop fields');
    for (const [key, item] of Object.entries(original)) assertAllNarrativeChanged(item, (translated as Record<string, unknown>)[key], key);
    return;
  }
  assert.deepEqual(translated, original);
}
function blankView(): RoomView {
  return { code: 'TEST', phase: 'investigation', round: 1, settings: { rounds: 5, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: true, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0, isMaster: false };
}
function role(characterId: string, culprit: boolean): Role {
  const character = CHARACTERS.find(item => item.id === characterId)!;
  const dossier = privateDossier(characterId);
  const confession = culprit ? ` Your crime: you killed Mayor Solomon Graves using an induction coil, staged a revolver shot, stole the alien power core, and arranged to sell the core at the Black Star auction. ${solution(characterId).method} ${solution(characterId).motive}` : '';
  return { ...dossier, characterId, name: character.name, gender: character.gender, alignment: culprit ? 'culprit' : 'innocent', brief: dossier.background, secret: dossier.secret + confession, objective: culprit ? 'Keep your crime secret and escape the final accusation.' : 'Compare the evidence and identify the culprit.', roleplayTip: dossier.roleplayTip + ' Some people in your backstory may be offstage tonight. If a mission names an absent character or faction, ask another guest to speak for their interests; relationships with absent people are background, never required evidence.' };
}

test('locale metadata accepts only supported language values and defaults to English', () => {
  assert.deepEqual(LANGUAGES.map(language => language.value), ['en', 'es', 'pt-BR']);
  for (const language of LANGUAGES) { assert.equal(normalizeLanguage(language.value), language.value); assert.ok(language.nativeLabel); }
  for (const invalid of [undefined, null, '', 'pt', 'pt-br', 'fr', {}, 2]) assert.equal(normalizeLanguage(invalid), 'en');
});

for (const language of languages) {
  test(`${language}: the entire server catalog is translated, with no English fallback or broken puzzle placeholders`, () => {
    const coverage = storyLocalizationCoverage(language);
    assert.ok(coverage.total >= 437, 'Coverage must include the full private dossiers and story banks');
    assert.equal(coverage.translated, coverage.total);
    assert.deepEqual(coverage.missing, []); assert.deepEqual(coverage.unchanged, []); assert.deepEqual(coverage.invalidPlaceholders, []);
  });

  test(`${language}: all 20 dossiers, 5 acts, 100 assigned slips, 15 searches and complete solutions translate for every culprit`, () => {
    let dossiers = 0, acts = 0, slips = 0, searches = 0, solutions = 0;
    const ids = CHARACTERS.map(character => character.id);
    for (const character of CHARACTERS) {
      for (const culprit of [false, true]) {
        const view = blankView(); view.me = { playerId: 'player', role: role(character.id, culprit), clues: [], votedFor: null, ready: true };
        const localized = localizeRoomView(view, language);
        assertAllNarrativeChanged(view, localized); dossiers++;
        assert.equal(localized.me!.role!.alignment, culprit ? 'culprit' : 'innocent');
        assert.equal(localized.me!.role!.name, character.name);
      }
      for (let round = 1; round <= 5; round++) {
        const act = getAct(round, character.id);
        const translated = translateNarrative(act, language);
        assertAllNarrativeChanged(act, translated); acts++;
        assert.equal('correctOptionId' in translated.question, false); assert.equal('explanation' in translated.question, false);
        const question = getQuestion(round);
        assertAllNarrativeChanged(question, translateNarrative(question, language));
        assert.equal(translateNarrative(question, language).correctOptionId, question.correctOptionId);
        for (let index = 0; index < 20; index++) {
          const clue = makeClue(round, index, character.id, ids);
          assertAllNarrativeChanged(clue, translateNarrative(clue, language)); slips++;
        }
        for (const location of act.locations) {
          const clue = searchClue(round, location.id, character.id);
          assertAllNarrativeChanged(clue, translateNarrative(clue, language)); searches++;
        }
        // Unnamed independent fragments retain the original 5-by-4 candidate puzzle in both languages.
        const publicText = JSON.stringify(translated);
        assert.equal(publicText.includes(character.name), false);
        assert.equal(publicText.includes(character.id), false);
        if (round >= 3) {
          const colors = language === 'es' ? ['Menta', 'Coral', 'Oro', 'Violeta'] : ['Menta', 'Coral', 'Ouro', 'Violeta'];
          const symbols = language === 'es' ? ['Cactus', 'Cometa', 'Espuela', 'Sol', 'Ojo'] : ['Cacto', 'Cometa', 'Espora', 'Sol', 'Olho'];
          const index = CHARACTERS.indexOf(character), color = colors[index % 4], symbol = symbols[Math.floor(index / 4)];
          assert.ok(translated.evidence.some(item => item.text.includes(color)));
          assert.ok(translated.evidence.some(item => item.text.includes(symbol)));
          assert.ok(translated.evidence.every(item => !(item.text.includes(color) && item.text.includes(symbol))));
          const seal = entrySeal(character.id);
          assert.equal(CHARACTERS.filter(item => entrySeal(item.id).color === seal.color).length, 5);
          assert.equal(CHARACTERS.filter(item => entrySeal(item.id).symbol === seal.symbol).length, 4);
        }
      }
      const result = solution(character.id);
      assertAllNarrativeChanged(result, translateNarrative(result, language)); solutions++;
    }
    assert.deepEqual({ dossiers, acts, slips, searches, solutions }, { dossiers: 40, acts: 100, slips: 2000, searches: 300, solutions: 20 });
  });

  test(`${language}: room view translation covers every visible field and preserves identities, scoring, answers and privacy`, () => {
    for (let round = 1; round <= 5; round++) {
      const character = CHARACTERS[round - 1];
      const generated = getAct(round, character.id);
      const view = blankView(); view.round = round; view.act = generated;
      view.notice = 'Dustfall has been upgraded. Your seats are saved; the game master can deal the new cast.';
      view.players = [{ id: 'player', name: 'English Player Name', gender: 'any', connected: true, ready: true, roleName: character.name, characterId: character.id }];
      view.clues = Array.from({ length: 20 }, (_, index) => ({ id: `clue-${index}`, ...makeClue(round, index, character.id, []), round, playerId: 'player', playerName: 'English Player Name', published: true }));
      view.me = { playerId: 'player', role: role(character.id, true), clues: view.clues, search: { locationId: generated.locations[0].id, ...searchClue(round, generated.locations[0].id, character.id) }, votedFor: 'other', ready: true, answeredOptionId: generated.question.options[0].id, previousAnswer: { round, optionId: generated.question.options[0].id, text: generated.question.options[0].text, correct: generated.question.options[0].id === getQuestion(round).correctOptionId }, suspicionId: 'other', score: 750 };
      view.questionResult = { round, correctOptionId: getQuestion(round).correctOptionId, explanation: getQuestion(round).explanation, counts: { [getQuestion(round).correctOptionId]: 2 } };
      view.result = { culpritId: 'player', tallies: { player: 3 }, caught: true, solution: solution(character.id), scores: [{ playerId: 'player', score: 750, correctAnswers: 3, cluesShared: 2, searches: 2, correctAccusation: true }] };
      const before = structuredClone(view);
      const localized = localizeRoomView(view, language);
      assertAllNarrativeChanged(view, localized);
      assert.deepEqual(view, before, 'A translated response must never mutate canonical state');
      assert.deepEqual(localizeRoomView(view, 'en'), view, 'English remains canonical');
    }
    const engine = new GameEngine(); const master = engine.create();
    for (let index = 0; index < 4; index++) engine.join({ code: master.code, name: `Player ${index}`, gender: 'any' });
    engine.command(master.code, master.token, { type: 'start' });
    for (const token of [undefined, master.token]) {
      const publicView = localizeRoomView(engine.view(master.code, token), language);
      assert.equal(publicView.me, undefined); assert.equal(publicView.result, undefined);
      assert.doesNotMatch(JSON.stringify(publicView), /alignment|correctOptionId|secret|alibi|masterToken|culpritId/);
    }
  });

  test(`${language}: localization preserves all legal party sizes and shortened 1- and 2-act games`, () => {
    for (let count = 4; count <= 20; count++) for (const rounds of [1, 2]) {
      const engine = new GameEngine(); const master = engine.create();
      const players = Array.from({ length: count }, (_, index) => engine.join({ code: master.code, name: `Guest ${index}`, gender: 'any' }));
      engine.command(master.code, master.token, { type: 'settings', settings: { rounds } });
      engine.command(master.code, master.token, { type: 'start' });
      for (const session of players) { const canonical = engine.view(master.code, session.token); assertAllNarrativeChanged(canonical, localizeRoomView(canonical, language)); }
      for (let round = 1; round <= rounds; round++) {
        engine.command(master.code, master.token, { type: 'advance' });
        const canonical = engine.view(master.code, players[0].token);
        const localized = localizeRoomView(canonical, language);
        assertAllNarrativeChanged(canonical, localized);
        assert.equal(localized.players.length, count); assert.equal(localized.round, round);
        assert.equal('correctOptionId' in localized.act!.question, false);
      }
      engine.command(master.code, master.token, { type: 'advance' });
      const voting = localizeRoomView(engine.view(master.code), language);
      assert.equal(voting.phase, 'voting');
      assert.equal(voting.act!.evidence.length, 9, 'Short games must retain the complete original three-act proof chain');
    }
  });
}

test('closed-act previous answers localize in all three languages while option IDs, correctness and private viewer filtering stay stable', () => {
  const engine = new GameEngine(); const master = engine.create();
  const players = Array.from({ length: 4 }, (_, index) => engine.join({ code: master.code, name: `Guest ${index}`, gender: 'any' }));
  engine.command(master.code, master.token, { type: 'start' });
  engine.command(master.code, master.token, { type: 'advance' });
  const question = getQuestion(1);
  const chosen = [question.options.find(option => option.id === question.correctOptionId)!, question.options.find(option => option.id !== question.correctOptionId)!];
  for (let index = 0; index < 2; index++) {
    engine.command(master.code, players[index].token, { type: 'answer', optionId: chosen[index].id });
    assert.equal(engine.view(master.code, players[index].token).me!.previousAnswer, undefined, 'A submitted answer cannot expose correctness before the act closes');
  }
  engine.command(master.code, master.token, { type: 'advance' });
  for (const language of ['en', 'es', 'pt-BR'] as const) {
    for (let index = 0; index < 2; index++) {
      const canonical = engine.view(master.code, players[index].token);
      const localized = localizeRoomView(canonical, language);
      assert.deepEqual(localized.me!.previousAnswer, { round: 1, optionId: chosen[index].id, text: localizeStoryText(chosen[index].text, language), correct: index === 0 });
      assert.equal(canonical.me!.previousAnswer!.text, chosen[index].text);
      assert.equal(localized.me!.playerId, players[index].playerId);
    }
    for (const token of [undefined, master.token]) {
      const publicView = localizeRoomView(engine.view(master.code, token), language);
      assert.equal(publicView.me, undefined);
      assert.equal(JSON.stringify(publicView).includes('previousAnswer'), false);
    }
    assert.equal(localizeRoomView(engine.view(master.code, players[2].token), language).me!.previousAnswer, undefined);
  }
});
