import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomView } from '../shared/types.js';
import { captionAt, cinematicEvent, CinematicHistory, parseCinematicManifest, presentationCommandKey, shouldAutoplayCinematic, syncClueCue } from '../shared/cinematics.js';

function room(patch: Partial<RoomView> = {}): RoomView {
  return { code: 'DUST', gameId: 'game-one', masterReady: true, phase: 'roles', round: 0,
    settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: true,
    timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0, isMaster: false, ...patch };
}
test('cinematic events follow game identity, phase and logical story act, never polling revisions', () => {
  assert.equal(cinematicEvent(room({ phase: 'lobby' })), null);
  assert.equal(cinematicEvent(room({ masterReady: false })), null);
  assert.deepEqual(cinematicEvent(room()), { key: 'game-one:roles:0', clipId: 'opening' });
  for (let round = 1; round <= 5; round++) assert.equal(cinematicEvent(room({ phase: 'investigation', round, settings: { rounds: 5, roundSeconds: 300, maxPlayers: 20 } }))?.clipId, `act-${round}`);
  assert.equal(cinematicEvent(room({ phase: 'investigation', round: 1, settings: { rounds: 1, roundSeconds: 300, maxPlayers: 20 } }))?.clipId, 'act-3');
  assert.equal(cinematicEvent(room({ phase: 'investigation', round: 1, settings: { rounds: 2, roundSeconds: 300, maxPlayers: 20 } }))?.clipId, 'act-1');
  assert.equal(cinematicEvent(room({ phase: 'investigation', round: 2, settings: { rounds: 2, roundSeconds: 300, maxPlayers: 20 } }))?.clipId, 'act-3');
  assert.equal(cinematicEvent(room({ phase: 'voting' }))?.clipId, 'voting');
  assert.deepEqual(cinematicEvent(room({ revision: 99 })), cinematicEvent(room({ revision: 1 })));
});
test('all ending variants are selected by the actual verdict and top tally', () => {
  const ending = (caught: boolean, tallies: Record<string, number>) => cinematicEvent(room({ phase: 'results', result: { culpritId: 'a', caught, tallies } }))?.clipId;
  assert.equal(ending(true, { a: 3, b: 1 }), 'caught');
  assert.equal(ending(false, { a: 1, b: 3 }), 'escaped-wrong');
  assert.equal(ending(false, { a: 2, b: 2, c: 1 }), 'escaped-tie');
  assert.equal(ending(false, { a: 0, b: 0 }), 'escaped-tie');
  assert.equal(ending(false, {}), 'escaped-tie');
});
test('per-tab history deduplicates polling and refreshes while a new game still plays', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const first = new CinematicHistory(storage);
  const key = cinematicEvent(room())!.key;
  assert.equal(first.claim(key), true);
  assert.equal(first.claim(key), false);
  assert.equal(new CinematicHistory(storage).claim(key), false);
  assert.equal(first.claim(cinematicEvent(room({ gameId: 'game-two' }))!.key), true);
});
test('only the first later shared clue per act plays after its intro, never stale or private clues', () => {
  let state = syncClueCue(undefined, 'game-one:investigation:1', ['already-public'], true).state;
  let next = syncClueCue(state, 'game-one:investigation:1', ['already-public', 'new-clue'], true);
  assert.equal(next.play, false); state = next.state;
  next = syncClueCue(state, 'game-one:investigation:1', ['already-public', 'new-clue'], false);
  assert.equal(next.play, true); state = next.state;
  assert.equal(syncClueCue(state, 'game-one:investigation:1', ['already-public', 'new-clue', 'second-clue'], false).play, false);
  next = syncClueCue(state, 'game-one:investigation:2', ['already-public', 'new-clue', 'second-clue'], false);
  assert.equal(next.play, false);
  assert.equal(syncClueCue(next.state, 'game-one:investigation:2', ['already-public', 'new-clue', 'second-clue', 'act-two-clue'], false).play, true);
});
test('caption time windows use Portuguese and end exactly at the cue boundary', () => {
  const cues = [{ start: 1, end: 3, text: 'Uma nova pista.' }, { start: 3, end: 5, text: 'Compare as provas.' }];
  assert.equal(captionAt(cues, .9), '');
  assert.equal(captionAt(cues, 1), 'Uma nova pista.');
  assert.equal(captionAt(cues, 3), 'Compare as provas.');
  assert.equal(captionAt(cues, 5), '');
});
test('manifest accepts confirmed HTTPS media and rejects empty, unsupported and malformed clips', () => {
  const clip = { id: 'opening', title: 'The opening', src: 'https://media.example/opening.mp4', duration: 18, captions: { en: '/media/captions/opening.en.vtt', ptBR: '/media/captions/opening.pt-BR.vtt' }, cues: { en: [{ start: 0, end: 2, text: 'Dustfall.' }], ptBR: [{ start: 0, end: 2, text: 'Dustfall.' }] } };
  assert.equal(parseCinematicManifest({ version: 1, clips: [clip] }).clips.length, 1);
  assert.equal(parseCinematicManifest({ version: 1, clips: [{ ...clip, src: '' }, { ...clip, src: 'javascript:bad' }, { ...clip, id: 'fake' }] }).clips.length, 0);
  assert.equal(parseCinematicManifest({ version: 2, clips: [clip] }).clips.length, 0);
  assert.equal(parseCinematicManifest(null).clips.length, 0);
});

test('TV voting and suspicion expose the public seal colors and symbols without private dossiers', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { Display } = await import('../src/components/Display.js');
  const { CHARACTERS, entrySeal } = await import('../shared/characters.js');
  const players = CHARACTERS.map((character, index) => ({ id: `p${index}`, name: `Guest ${index}`, gender: character.gender, connected: true, ready: true, characterId: character.id, roleName: character.name }));
  const render = (phase: RoomView['phase']) => renderToStaticMarkup(createElement(Display, { room: room({ phase, players, round: 3 }), connected: true, joinOrigin: 'https://dustfall.example' }));
  for (const phase of ['roles', 'investigation', 'voting'] as const) {
    const html = render(phase);
    for (const character of CHARACTERS) assert.ok(html.includes(`Public admission seal: ${entrySeal(character.id).label}`), `${phase}: ${character.name}`);
    assert.equal((html.match(/aria-label="Public admission seal:/g) || []).length, 20);
  }
  assert.match(render('voting'), /Match the color and symbol on each public admission seal/);
  assert.doesNotMatch(render('lobby'), /Public admission seal:/);
});

test('GM film controls and Portuguese captions are available while paused and disabled for guests', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { Master } = await import('../src/components/Master.js');
  const render = (view: RoomView) => renderToStaticMarkup(createElement(Master, { room: view, connected: true, command: async () => {}, joinOrigin: 'https://dustfall.example', onHome: () => {} }));
  const view = room({ isMaster: true, phase: 'investigation', timer: { endsAt: null, remaining: 100, isPaused: true } });
  const html = render(view);
  const filmButton = (markup: string, text: string) => markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes(text)) || '';
  assert.ok(filmButton(html, 'Skip current film'));
  assert.doesNotMatch(filmButton(html, 'Skip current film'), /disabled/);
  assert.doesNotMatch(filmButton(html, 'Replay current film'), /disabled/);
  assert.match(html, /Português \(Brasil\)/);
  assert.match(filmButton(render({ ...view, isMaster: false }), 'Replay current film'), /disabled/);
  assert.match(filmButton(render({ ...view, phase: 'lobby' }), 'Skip current film'), /disabled/);
});


test('presentation dedupe includes its event because command serials reset for a new game', () => {
  const before = presentationCommandKey({ serial: 1, eventKey: 'old:roles:0', control: 'skip' });
  const after = presentationCommandKey({ serial: 1, eventKey: 'new:roles:0', control: 'replay' });
  assert.notEqual(before, after);
  assert.equal(after, presentationCommandKey({ serial: 1, eventKey: 'new:roles:0', control: 'replay' }));
  assert.equal(presentationCommandKey(undefined), undefined);
});


test('a persisted GM skip suppresses a fresh display’s matching film while stale phase skips do not', () => {
  const event = cinematicEvent(room())!;
  const options = { reducedMotion: false, viewed: false };
  assert.equal(shouldAutoplayCinematic(event, { ...options, presentation: { serial: 1, eventKey: event.key, control: 'skip' } }), false);
  assert.equal(shouldAutoplayCinematic(event, { ...options, presentation: { serial: 1, eventKey: 'first-game:investigation:1', control: 'skip' } }), true);
  assert.equal(shouldAutoplayCinematic(event, { ...options, presentation: { serial: 1, eventKey: event.key, control: 'replay' } }), true);
  assert.equal(shouldAutoplayCinematic(event, { ...options, viewed: true, presentation: { serial: 1, eventKey: event.key, control: 'replay' } }), false);
  assert.equal(shouldAutoplayCinematic(event, { ...options, reducedMotion: true }), false);
});

test('the GM can pause and resume the ending presentation from results', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { Master } = await import('../src/components/Master.js');
  const render = (paused: boolean) => renderToStaticMarkup(createElement(Master, { room: room({ phase: 'results', isMaster: true, timer: { endsAt: null, remaining: 0, isPaused: paused }, result: { culpritId: 'a', caught: true, tallies: { a: 4 } } }), connected: true, command: async () => {}, joinOrigin: 'https://dustfall.example', onHome: () => {} }));
  const hasButton = (html: string, label: string) => (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []).some(button => button.endsWith(`${label}</button>`));
  assert.equal(hasButton(render(false), 'Pause game'), true);
  assert.equal(hasButton(render(true), 'Resume game'), true);
});
