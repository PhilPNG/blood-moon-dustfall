import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Player, CharacterDossier, Join } from '../src/components/Player';
import type { RoomView } from '../shared/types';
import { CHARACTERS, entrySeal } from '../shared/characters';
import { LanguageProvider } from '../src/i18n';

function room(phase: RoomView['phase'] = 'roles'): RoomView {
  return {
    code: 'DUST', phase, round: phase === 'roles' ? 0 : 1,
    settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 },
    players: CHARACTERS.map((character, index) => ({ id: `p${index}`, name: `Guest ${index} with a long name`, characterId: character.id, roleName: character.name, gender: character.gender, ready: false, connected: true })),
    isLocked: true, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0, isMaster: false,
    me: { playerId: 'p0', ready: false, votedFor: null, clues: [], score: 25, role: { characterId: 'silas-vale', name: CHARACTERS[0].name, gender: 'man', alignment: 'culprit', brief: 'Private background text', background: 'Private full background', alibi: 'Distinctive alibi text', secret: 'SENSITIVE CONFESSION TEXT', objective: 'SENSITIVE CULPRIT MISSION', objectives: ['Read the mission text'], relationships: [{ name: 'Jed', detail: 'Relationship detail' }], roleplayTip: 'Roleplay tip' } },
    act: { title: 'The Silent Shot', narration: 'Read aloud narration', prompt: 'Compare the evidence.', evidence: [{ id: 'e1', title: 'Automatic public clue', text: 'Automatic public clue text' }], locations: [{ id: 'saloon', label: 'Saloon', description: 'Search the bar' }, { id: 'office', label: 'Office', description: 'Check the desk' }, { id: 'ship', label: 'Starship', description: 'Inspect the vault' }], question: { id: 'q1', prompt: 'What killed Graves?', options: [{ id: 'one', text: 'An induction coil' }, { id: 'two', text: 'The staged shot' }] } },
    suspicions: { p1: 3 }, answerCount: 0, searchCount: 0,
  };
}
function render(view: RoomView, connected = true) { return renderToStaticMarkup(createElement(Player, { room: view, connected, command: async () => {}, onLeave: () => {} })); }
function button(html: string, label: string) { const found = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(value => value.includes(label)); assert.ok(found, `Expected ${label}`); return found; }

test('profile opens immediately with portrait and alibi while culprit information stays hidden', () => {
  const view = room(); const html = render(view);
  assert.match(html, /assets\/characters\/silas-vale.webp/);
  assert.match(html, /Private full background/);
  assert.match(html, /Distinctive alibi text/);
  assert.ok(html.includes(entrySeal('silas-vale').label));
  assert.match(html, /Your entry seal is public/);
  assert.match(html, /aria-label="Character dossier"/);
  assert.match(html, /Profile|profile/);
  assert.match(html, /Secrets|secrets/);
  assert.match(html, /Missions|missions/);
  assert.doesNotMatch(html, /SENSITIVE CONFESSION TEXT|SENSITIVE CULPRIT MISSION|YOU ARE THE CULPRIT/);
  assert.doesNotMatch(button(html, 'I’m ready'), /disabled/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(CharacterDossier, { role: view.me?.role })), /SENSITIVE CONFESSION TEXT/);
});

test('investigation renders searchable locations, immutable answers and all portrait suspects', () => {
  const view = room('investigation'); const html = render(view);
  for (const label of ['Saloon', 'Office', 'Starship', 'An induction coil', 'The staged shot']) assert.doesNotMatch(button(html, label), /disabled/);
  assert.match(html, /Automatic public clue text/);
  assert.match(html, /25<\/strong> POINTS/);
  assert.equal((html.match(/class="phone-suspect /g) ?? []).length, 19);
  for (const character of CHARACTERS.slice(1)) assert.ok(html.includes(entrySeal(character.id).label));
  assert.equal((html.match(/class="phone-suspicion-row"/g) ?? []).length, 20);
  assert.doesNotMatch(html, /SENSITIVE CONFESSION TEXT|correctOptionId|ANSWER EXPLAINED/);
  view.me!.answeredOptionId = 'one';
  const answered = render(view);
  assert.match(button(answered, 'An induction coil'), /disabled/);
  assert.match(button(answered, 'The staged shot'), /disabled/);
  assert.match(answered, /Answer locked/);
});

test('private search receipt replaces search tiles and pause or connection loss blocks mutations', () => {
  const view = room('investigation');
  view.me!.search = { locationId: 'saloon', title: 'My private find', text: 'The clue found in the bar' };
  const html = render(view);
  assert.match(html, /My private find/); assert.match(html, /The clue found in the bar/);
  assert.doesNotMatch(html, /class="phone-search-tile"/);
  view.timer.isPaused = true;
  assert.match(button(render(view), 'An induction coil'), /disabled/);
  assert.match(button(render(view), 'Guest 1 with a long name'), /disabled/);
  view.timer.isPaused = false;
  assert.match(button(render(view, false), 'An induction coil'), /disabled/);
  assert.match(render(view, false), /Reconnecting/);
});

test('voting keeps public automatic and shared evidence reviewable and sealed vote is immutable', () => {
  const view = room('voting');
  view.clues = Array.from({ length: 20 }, (_, index) => ({ id: `clue${index}`, title: `Shared evidence ${index}`, text: `Evidence ${index}`, round: 1, playerId: `p${index}`, playerName: `Guest ${index}`, published: true }));
  view.clues.push({ id: 'hidden', title: 'UNPUBLISHED CLUE', text: 'PRIVATE OTHER PLAYER CLUE', round: 1, playerId: 'p1', playerName: 'Guest 1', published: false });
  let html = render(view);
  assert.match(html, /Automatic public clue text/);
  for (const character of CHARACTERS.slice(1)) assert.ok(html.includes(entrySeal(character.id).label));
  for (let index = 0; index < 20; index++) assert.ok(html.includes(`Shared evidence ${index}`));
  assert.doesNotMatch(html, /UNPUBLISHED CLUE|PRIVATE OTHER PLAYER CLUE/);
  assert.match(button(html, 'Make my accusation'), /disabled/);
  view.me!.votedFor = 'p1'; html = render(view);
  assert.match(html, /ACCUSATION FILED/); assert.match(html, /Your vote is sealed and final/);
  assert.doesNotMatch(html, /class="phone-suspect /);
});

test('results include own award, public solution, all accusations and previous case explanation', () => {
  const view = room('results');
  view.result = { culpritId: 'p1', caught: true, tallies: { p1: 10 }, scores: [{ playerId: 'p0', score: 350, correctAnswers: 1, searches: 1, cluesShared: 1, correctAccusation: true }], solution: { headline: 'The mayor’s last treaty', summary: 'The whole solution', method: 'The induction coil method', motive: 'The core sale motive', timeline: [{ time: '11:57', text: 'The documented sequence' }] } };
  view.questionResult = { round: 3, correctOptionId: 'one', explanation: 'Final case explanation', counts: {} };
  const html = render(view);
  assert.match(html, /Final case explanation/);
  for (const text of ['350 POINTS', 'The whole solution', 'The induction coil method', 'The core sale motive', 'The documented sequence']) assert.ok(html.includes(text));
  assert.equal((html.match(/class="phone-tally-row"/g) ?? []).length, 20);
});

test('joining offers exactly three explicit unselected required character choices', () => {
  const html = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: 'en', children: createElement(Join, { initialCode: 'dust', onJoined: () => {} }) }));
  const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
  assert.equal(radios.length, 3);
  for (const radio of radios) { assert.match(radio, /required/); assert.doesNotMatch(radio, /checked/); }
  assert.doesNotMatch(html, /Flexible \(legacy\)/);
});
