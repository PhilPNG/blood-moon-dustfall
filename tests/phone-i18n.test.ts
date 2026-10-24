import { recoveryTranslations } from '../src/recovery-translations';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CharacterDossier, Join, PhoneRoundProgress, Player, actionFeedback, phoneStage } from '../src/components/Player';
import { LANGUAGE_STORAGE_KEY, LanguageProvider, hasSavedLanguage, phoneTranslations, readLanguage, translate } from '../src/i18n';
import { publicCharacterTranslations } from '../src/character-translations';
import { shellTranslations } from '../src/shell-translations';
import { CHARACTERS } from '../shared/characters';
import type { Language } from '../shared/locale';
import type { RoomView } from '../shared/types';

function localized(language: Language, children: ReactNode) { return renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children })); }
function room(phase: RoomView['phase'], round = 1): RoomView {
  return { code: 'DUST', gameId: 'case-1', phase, round, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [{ id: 'me', name: 'Alex', gender: 'any', connected: true, ready: false, characterId: 'silas-vale' }, { id: 'other', name: 'Sam', gender: 'any', connected: true, ready: true, characterId: 'ada-crowe' }], isLocked: true, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0, isMaster: false, me: { playerId: 'me', votedFor: null, clues: [], ready: false, score: 0 } };
}

test('a fresh join starts with three native language choices before any name, room or gender fields', () => {
  const html = renderToStaticMarkup(createElement(Join, { initialCode: 'DUST', onJoined: () => {} }));
  for (const label of ['English', 'Español', 'Português (Brasil)']) assert.ok(html.includes(label));
  assert.equal((html.match(/class="language-picker-choice"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<input|join-form|join-name|join-gender/);
});

test('Spanish and Brazilian Portuguese join forms localize labels and keep language switching available', () => {
  for (const language of ['es', 'pt-BR'] as const) {
    const html = localized(language, createElement(Join, { initialCode: 'DUST', onJoined: () => {} }));
    assert.match(html, /value="DUST"/);
    for (const source of ['Your name', 'Choose your character’s gender', 'Join the mystery', 'What should we call you?', 'This is your character preference. Ten men and ten women are available; “Either” fills either available seat.']) {
      assert.ok(html.includes(translate(language, source)), `Missing ${language} ${source}`);
      assert.ok(!html.includes(source), `English join text in ${language}: ${source}`);
    }
    assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
    assert.match(html, /class="language-menu"/);
  }
});

test('language preference distinguishes first visit, persists explicit English and tolerates unavailable storage', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let saved: string | null = null;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem(key: string) { assert.equal(key, LANGUAGE_STORAGE_KEY); return saved; } } });
  try {
    assert.equal(readLanguage(), 'en'); assert.equal(hasSavedLanguage(), false);
    for (const language of ['en', 'es', 'pt-BR'] as const) { saved = language; assert.equal(readLanguage(), language); assert.equal(hasSavedLanguage(), true); }
    saved = 'fr'; assert.equal(readLanguage(), 'en'); assert.equal(hasSavedLanguage(), false);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
    assert.equal(readLanguage(), 'en'); assert.equal(hasSavedLanguage(), false);
  } finally { if (before) Object.defineProperty(globalThis, 'localStorage', before); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('every phone UI translation key and every public character field has both translations', () => {
  const source = readFileSync(new URL('../src/components/Player.tsx', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/\bt\(["']([^"']+)["']/g)].map(match => match[1]);
  const registry = { ...phoneTranslations, ...shellTranslations, ...publicCharacterTranslations, ...recoveryTranslations };
  for (const key of keys) for (const language of ['es', 'pt-BR'] as const) assert.ok(registry[key]?.[language]?.trim(), `Missing ${language}: ${key}`);
  for (const character of CHARACTERS) for (const field of ['title', 'faction', 'bio', 'personality', 'costume'] as const) {
    for (const language of ['es', 'pt-BR'] as const) {
      assert.ok(publicCharacterTranslations[character[field]]?.[language]);
      assert.notEqual(translate(language, character[field]), character[field], `${character.id}.${field}`);
    }
  }
  assert.equal(translate('es', 'Accuse {name}?', { name: 'Alex $& <script>' }), '¿Acusar a Alex $& <script>?');
  assert.equal(translate('pt-BR', 'ACT {round} / {total}', { round: 2, total: 3 }), 'ATO 2 / 3');
});

test('all phone phases and public dossier fallbacks render in the selected language without exposing private secrets', () => {
  for (const language of ['es', 'pt-BR'] as const) {
    const dossier = localized(language, createElement(CharacterDossier, { role: { name: CHARACTERS[0].name, characterId: CHARACTERS[0].id, gender: 'man', alignment: 'culprit', brief: '', objective: 'PRIVATE OBJECTIVE', secret: 'PRIVATE CONFESSION' } }));
    for (const field of ['title', 'personality', 'costume'] as const) {
      assert.ok(dossier.includes(translate(language, CHARACTERS[0][field])));
      assert.ok(!dossier.includes(CHARACTERS[0][field]));
    }
    assert.doesNotMatch(dossier, /PRIVATE CONFESSION|PRIVATE OBJECTIVE|YOU ARE THE CULPRIT/);
    for (const phase of ['lobby', 'roles', 'investigation', 'voting', 'results'] as const) {
      const view = room(phase);
      const html = localized(language, createElement(Player, { room: view, command: async () => {}, connected: true, onLeave: () => {} }));
      for (const source of ['Quick rules', 'KEEP YOUR SECRETS CLOSE.', 'Language', 'Leave room', 'The method', 'Make my accusation', 'YOUR PRIVATE PHONE']) assert.ok(!html.includes(`>${source}<`), `${phase} leaks ${source}`);
      assert.ok(html.includes(translate(language, 'Quick rules')));
      assert.match(html, /class="language-menu"/);
    }
  }
});

test('round progress reflects actual phases and rounds, while polling and pause do not create new chapters', () => {
  const first = room('investigation', 1);
  const key = phoneStage(first).key;
  assert.equal(phoneStage({ ...first, revision: 99, timer: { ...first.timer, isPaused: true } } as RoomView).key, key);
  const second = { ...first, round: 2 };
  assert.notEqual(phoneStage(second).key, key);
  assert.notEqual(phoneStage({ ...first, gameId: 'case-2' }).key, key);
  for (const [phase, round, step] of [['roles', 0, 0], ['investigation', 1, 1], ['investigation', 3, 3], ['voting', 3, 4], ['results', 3, 5]] as const) {
    const view = room(phase, round);
    assert.equal(phoneStage(view).current, step);
    const html = localized('es', createElement(PhoneRoundProgress, { room: view }));
    assert.match(html, new RegExp(`data-stage="${step}"`));
    assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  }
  const css = readFileSync(new URL('../src/components/player.css', import.meta.url), 'utf8');
  assert.match(css, /\.phone-round-transition\{[^}]*pointer-events:none/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.equal(actionFeedback({ type: 'answer', optionId: 'a' }), 'Answer sealed for this act');
  assert.equal(actionFeedback({ type: 'vote', playerId: 'p1' }), 'Final accusation sealed');
});

test('server answer receipts survive a fresh phone render and language changes after act close', () => {
  const canonicalOption = 'silent-induction-coil';
  const answerText = { es: 'Una bobina de inducción oculta', 'pt-BR': 'Uma bobina de indução escondida' };
  for (const phase of ['investigation', 'voting', 'results'] as const) for (const correct of [true, false]) {
    for (const language of ['es', 'pt-BR'] as const) {
      // Each SSR render is a new phone instance with no in-memory answer history.
      const view = room(phase, phase === 'investigation' ? 2 : 3);
      view.questionResult = { round: phase === 'investigation' ? 1 : 3, correctOptionId: 'server-explanation-option', explanation: language === 'es' ? 'Explicación del acto cerrado.' : 'Explicação do ato encerrado.', counts: {} };
      view.me!.previousAnswer = { round: view.questionResult.round, optionId: canonicalOption, text: answerText[language], correct };
      const html = localized(language, createElement(Player, { room: view, command: async () => {}, connected: true, onLeave: () => {} }));
      assert.match(html, /data-answer-option="silent-induction-coil"/);
      assert.ok(html.includes(translate(language, 'You answered: {answer}', { answer: answerText[language] })));
      const feedback = correct ? 'Correct · +100 points!' : phase === 'results' ? 'The final case answer' : 'A clue for next time.';
      assert.ok(html.includes(translate(language, feedback)), `${language} ${phase} ${correct} lost feedback`);
      assert.doesNotMatch(html, /Your submitted answer|You answered:|Correct · \+100 points!/);
    }
  }
});

test('a server receipt for a different act does not attach stale feedback to the current explanation', () => {
  const view = room('investigation', 3);
  view.questionResult = { round: 2, correctOptionId: 'coil', explanation: 'Explicación del segundo acto.', counts: {} };
  view.me!.previousAnswer = { round: 1, optionId: 'earlier-option', text: 'OBSOLETE PRIVATE ANSWER', correct: true };
  const html = localized('es', createElement(Player, { room: view, command: async () => {}, connected: true, onLeave: () => {} }));
  assert.match(html, /Explicación del segundo acto/);
  assert.doesNotMatch(html, /OBSOLETE PRIVATE ANSWER|data-answer-option/);
});

test('result award counts agree with singular, plural and zero in all phone languages', () => {
  const expected = {
    en: ['1 search · 1 clue shared · 2 correct answers', '0 searches · 2 clues shared · 1 correct answer'],
    es: ['1 búsqueda · 1 pista compartida · 2 respuestas correctas', '0 búsquedas · 2 pistas compartidas · 1 respuesta correcta'],
    'pt-BR': ['1 busca · 1 pista compartilhada · 2 respostas corretas', '0 buscas · 2 pistas compartilhadas · 1 resposta correta'],
  };
  for (const language of ['en', 'es', 'pt-BR'] as const) for (const [index, counts] of [[1, 1, 2], [0, 2, 1]].entries()) {
    const view = room('results', 3);
    view.result = { culpritId: 'other', caught: true, tallies: {}, scores: [{ playerId: 'me', score: 100, searches: counts[0], cluesShared: counts[1], correctAnswers: counts[2], correctAccusation: false }] };
    const html = localized(language, createElement(Player, { room: view, command: async () => {}, connected: true, onLeave: () => {} }));
    assert.ok(html.includes(expected[language][index]), expected[language][index]);
  }
});

test('live Spanish vote remainder agrees with one pending accusation', () => {
  const view = room('voting', 3);
  for (const [votes, expected] of [[1, '1 pendiente'], [0, '2 pendientes']] as const) {
    view.votesCount = votes;
    const html = localized('es', createElement(Player, { room: view, command: async () => {}, connected: true, onLeave: () => {} }));
    assert.ok(html.includes(`<small>${expected}</small>`));
  }
});
