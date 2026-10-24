import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function modules() {
  const characters = await import('../shared/characters.js');
  const story = await import('../server/story.js');
  return { ...characters, ...story };
}

test('the authored story contracts are available separately from the browser-safe character deck', async () => {
  await assert.doesNotReject(modules);
});

test('the complete deck has ten men, ten women, unique identities and real public portraits', async () => {
  const { CHARACTERS, characterById } = await modules();
  assert.equal(CHARACTERS.length, 20);
  assert.equal(CHARACTERS.filter(character => character.gender === 'man').length, 10);
  assert.equal(CHARACTERS.filter(character => character.gender === 'woman').length, 10);
  assert.equal(new Set(CHARACTERS.map(character => character.id)).size, 20);
  assert.equal(new Set(CHARACTERS.map(character => character.name)).size, 20);
  for (const character of CHARACTERS) {
    assert.deepEqual(Object.keys(character).sort(), ['id', 'name', 'gender', 'title', 'faction', 'bio', 'personality', 'costume', 'color', 'portrait'].sort());
    assert.equal(characterById(character.id), character);
    assert.equal(character.portrait, `/assets/characters/${character.id}.webp`);
    assert.match(character.color, /^#[0-9a-f]{6}$/i);
    assert.ok(character.bio.length >= 100, `${character.name} needs a substantial public introduction`);
    assert.ok(character.personality.length >= 35);
    assert.ok(character.costume.length >= 35);
  }
  assert.equal(characterById('missing-person'), undefined);
});

test('every character has a distinct playable private dossier compatible with a variable culprit', async () => {
  const { CHARACTERS, privateDossier } = await modules();
  const secrets = new Set<string>();
  for (const character of CHARACTERS) {
    const dossier = privateDossier(character.id);
    assert.ok(dossier.background.length >= 160, character.id);
    assert.ok(dossier.secret.length >= 100, character.id);
    assert.ok(dossier.alibi.length >= 90, character.id);
    assert.equal(dossier.objectives.length, 2);
    assert.equal(dossier.relationships.length, 2);
    assert.ok(dossier.objectives.every(objective => objective.length >= 45));
    assert.ok(dossier.relationships.every(relationship => CHARACTERS.some(other => other.name === relationship.name) && relationship.detail.length >= 65));
    assert.ok(dossier.roleplayTip.length >= 75);
    assert.doesNotMatch(dossier.alibi, /you (are innocent|did not kill|could not have killed)|with you (the entire|all) time/i);
    secrets.add(dossier.secret);
  }
  assert.equal(secrets.size, 20);
  assert.throws(() => privateDossier('absent'), /character/i);
});

test('public first-act evidence explains the murder without naming a randomly selected culprit', async () => {
  const { CHARACTERS, getAct } = await modules();
  for (const character of CHARACTERS) {
    const act = getAct(1, character.id);
    const evidence = JSON.stringify(act.evidence);
    assert.match(evidence, /induction coil/i);
    assert.match(evidence, /blank|staged/i);
    assert.equal(evidence.includes(character.name), false);
    assert.equal('correctOptionId' in act.question, false);
    assert.equal('explanation' in act.question, false);
  }
});

test('public entry seals form twenty stable unique color-and-symbol combinations', async () => {
  const { CHARACTERS, entrySeal } = await modules();
  const colors = ['Mint', 'Coral', 'Gold', 'Violet'];
  const symbols = ['Cactus', 'Comet', 'Spur', 'Sun', 'Eye'];
  const labels = new Set<string>();
  for (const [index, character] of CHARACTERS.entries()) {
    const seal = entrySeal(character.id);
    assert.deepEqual(seal, { color: colors[index % 4], symbol: symbols[Math.floor(index / 4)], label: `${colors[index % 4]} ${symbols[Math.floor(index / 4)]}` });
    labels.add(seal.label);
  }
  assert.equal(labels.size, 20);
  assert.throws(() => entrySeal('unknown-person'), /character/i);
});

test('each culprit is deducible from intersecting public seal fragments without a pre-vote named answer', async () => {
  const { CHARACTERS, entrySeal, getAct, searchClue, solution, makeClue } = await modules();
  for (const culprit of CHARACTERS) {
    const seal = entrySeal(culprit.id);
    for (let round = 1; round <= 5; round++) {
      const act = getAct(round, culprit.id);
      const slips = Array.from({ length: 20 }, (_, index) => makeClue(round, index, culprit.id, CHARACTERS.map(character => character.id)));
      const searches = act.locations.map(location => searchClue(round, location.id, culprit.id));
      const preVote = JSON.stringify([act, slips, searches]);
      assert.equal(preVote.includes(culprit.name), false, `round ${round} names ${culprit.name}`);
      assert.equal(preVote.includes(culprit.id), false, `round ${round} encodes ${culprit.id}`);
      assert.doesNotMatch(preVote, /DF-[A-Z-]+/);
      if (round >= 3) {
        assert.ok(act.evidence.some(item => item.text.includes(seal.color)), `round ${round} color missing`);
        assert.ok(act.evidence.some(item => item.text.includes(seal.symbol)), `round ${round} symbol missing`);
        assert.ok(act.evidence.every(item => !(item.text.includes(seal.color) && item.text.includes(seal.symbol))), 'independent records should each supply one fragment');
        const candidates = CHARACTERS.filter(character => entrySeal(character.id).color === seal.color && entrySeal(character.id).symbol === seal.symbol);
        assert.deepEqual(candidates.map(character => character.id), [culprit.id]);
        assert.equal(CHARACTERS.filter(character => entrySeal(character.id).color === seal.color).length, 5);
        assert.equal(CHARACTERS.filter(character => entrySeal(character.id).symbol === seal.symbol).length, 4);
        assert.ok(slips.some(clue => clue.text.includes(seal.color)));
        assert.ok(slips.some(clue => clue.text.includes(seal.symbol)));
        assert.ok(slips.some(clue => !clue.text.includes(seal.color) && !clue.text.includes(seal.symbol)), 'supporting clues should vary rather than repeat the solution');
      }
    }
    const chain = JSON.stringify([getAct(1, culprit.id).evidence, getAct(2, culprit.id).evidence, getAct(3, culprit.id).evidence]);
    assert.match(chain, /induction coil/i);
    assert.match(chain, /Black Star/);
    assert.match(chain, /signature|registry/i);
    const result = solution(culprit.id);
    assert.ok(result.headline.includes(culprit.name));
    assert.match(result.method, /induction coil/i);
    assert.match(result.motive, /auction|sell/i);
    assert.ok(result.timeline.length >= 6);
    assert.deepEqual(result.timeline.slice(2, 6).map(event => event.time), ['8:56 PM', '8:57 PM', '8:58 PM', '8:59 PM']);
  }
});

test('all five acts have authored locations, valid searches and exactly one case-question answer', async () => {
  const { CHARACTERS, getAct, getQuestion, searchClue, makeClue } = await modules();
  for (let round = 1; round <= 5; round++) {
    for (const culprit of CHARACTERS) {
      const act = getAct(round, culprit.id);
      assert.ok(act.title.length > 8);
      assert.ok(act.narration.length > 100);
      assert.ok(act.prompt.length > 35);
      assert.equal(act.locations.length, 3);
      assert.equal(new Set(act.locations.map(location => location.id)).size, 3);
      for (const location of act.locations) {
        const clue = searchClue(round, location.id, culprit.id);
        assert.ok(clue.title.length > 5);
        assert.ok(clue.text.length > 90);
      }
      assert.throws(() => searchClue(round, 'invented-location', culprit.id), /location/i);
      const question = getQuestion(round);
      assert.equal(question.options.length, 3);
      assert.equal(question.options.filter(option => option.id === question.correctOptionId).length, 1);
      assert.deepEqual(act.question, { id: question.id, prompt: question.prompt, options: question.options });
      assert.ok(question.explanation.length > 90);
      const slips = Array.from({ length: 20 }, (_, index) => makeClue(round, index, culprit.id, CHARACTERS.map(character => character.id)));
      assert.equal(new Set(slips.map(clue => clue.text)).size, 20, `round ${round} should give twenty distinct evidence slips`);
      assert.ok(slips.every(clue => clue.text.length >= 75));
      assert.doesNotMatch(JSON.stringify([act, slips]), /placeholder|lorem ipsum|to be written|filler/i);
    }
  }
});

test('public deck source neither imports server story nor contains private dossier keys or solutions', async () => {
  const source = await readFile(new URL('../shared/characters.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /server\/|privateDossier|correctOptionId|Black Star|induction coil|\bsecret\s*:|\balibi\s*:/);
});

test('invalid story identifiers and rounds fail explicitly instead of inventing evidence', async () => {
  const { getAct, getQuestion, solution, makeClue } = await modules();
  assert.throws(() => getAct(1, 'nobody'), /character/i);
  assert.throws(() => solution('nobody'), /character/i);
  for (const round of [0, 6, 1.5, NaN]) assert.throws(() => getQuestion(round), /round/i);
  assert.throws(() => makeClue(1, -1, 'silas-vale', ['silas-vale']), /index/i);
});
