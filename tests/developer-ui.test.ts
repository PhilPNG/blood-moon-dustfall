import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { RoomView } from '../shared/types';
import type { Language } from '../shared/locale';
import { LanguageProvider } from '../src/i18n';

import * as developer from '../src/components/Developer';
const rawManifest: unknown = JSON.parse(readFileSync(new URL('../public/media/cinematics.json', import.meta.url), 'utf8'));
function view(overrides: Partial<RoomView> = {}): RoomView {
  return { code: 'TEST', rehearsal: true, phase: 'lobby', round: 0, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [{ id: 'dev', name: 'Developer', gender: 'any', connected: true, ready: false }], isLocked: false, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0, isMaster: true, ...overrides };
}
function render(name: keyof NonNullable<typeof developer>, props: Record<string, unknown> = {}, language: Language = 'en') {
  assert.ok(developer, 'Developer rehearsal UI must be implemented');
  const component = developer[name];
  assert.equal(typeof component, 'function');
  return renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(component as ComponentType<Record<string, unknown>>, props) }));
}
function button(html: string, label: string) { return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(markup => markup.includes(label)) ?? ''; }

test('the test toolbar exists only for an authenticated rehearsal master', () => {
  const props = { connected: true, command: async () => {} };
  const html = render('RehearsalControls', { ...props, room: view() });
  assert.ok(html.includes('Developer rehearsal controls')); assert.ok(html.includes('Start rehearsal'));
  assert.match(html, /href="\/play\/TEST"/); assert.match(html, /href="\/screen\/TEST"/);
  for (const room of [view({ rehearsal: false }), view({ rehearsal: undefined }), view({ isMaster: false })]) assert.equal(render('RehearsalControls', { ...props, room }), '');
});

test('Next names the real next action and a test run can skip unread roles and unfiled votes', () => {
  assert.ok(developer, 'Developer rehearsal UI must be implemented');
  const cases = [
    [view(), 'Start rehearsal', { type: 'start' }],
    [view({ phase: 'roles' }), 'Begin investigation', { type: 'advance' }],
    [view({ phase: 'investigation', round: 1 }), 'Next act', { type: 'advance' }],
    [view({ phase: 'investigation', round: 3 }), 'Open voting', { type: 'advance' }],
    [view({ phase: 'voting' }), 'Reveal results', { type: 'advance' }],
    [view({ phase: 'results' }), 'Reset rehearsal', { type: 'reset' }],
  ] as const;
  for (const [room, label, action] of cases) {
    const html = render('RehearsalControls', { room, connected: true, command: async () => {} });
    assert.ok(button(html, label), `${room.phase}: ${label}`); assert.doesNotMatch(button(html, label), /disabled/);
    assert.deepEqual(developer.rehearsalNext(room).action, action);
  }
});

test('offline, paused and empty states gate Next without disabling read-only phone links', () => {
  const props = { command: async () => {} };
  const offline = render('RehearsalControls', { ...props, room: view(), connected: false });
  assert.match(button(offline, 'Start rehearsal'), /disabled/); assert.match(offline, /href="\/play\/TEST"/);
  const empty = render('RehearsalControls', { ...props, room: view({ players: [] }), connected: true });
  assert.match(button(empty, 'Start rehearsal'), /disabled/); assert.ok(empty.includes('Add a player before starting.'));
  const paused = render('RehearsalControls', { ...props, room: view({ phase: 'roles', timer: { endsAt: null, remaining: 300, isPaused: true } }), connected: true });
  assert.match(button(paused, 'Begin investigation'), /disabled/); assert.doesNotMatch(button(paused, 'Resume game'), /disabled/);
  assert.doesNotMatch(button(paused, 'Replay film'), /disabled/);
});

test('developer entry labels its one-player mode and resumes a code without URL authority', () => {
  const html = render('DeveloperStart', { connected: false, creating: false, error: '', onCreate: async () => {} });
  assert.ok(html.includes('Create one-player rehearsal')); assert.match(button(html, 'Create one-player rehearsal'), /disabled/);
  assert.ok(html.includes('Party games still need four.')); assert.match(html, /pattern="\[A-Z\]\{4\}"/);
  assert.match(html, /href="\/films"/); assert.doesNotMatch(html, /name="rehearsal"|token=|recoveryCode=/);
});

test('gallery starts with loading and a manifest fallback, never unsolicited media', () => {
  const html = render('FilmLibrary');
  assert.ok(html.includes('Loading the film library…')); assert.match(html, /href="\/media\/cinematics\.json"/);
  assert.ok(html.includes('Ending spoilers')); assert.doesNotMatch(html, /<video|autoplay/);
});

test('validated gallery contains the eleven existing sources once, in story order, with ending spoilers', () => {
  assert.ok(developer, 'Developer rehearsal UI must be implemented');
  const clips = developer.parseFilmLibrary(rawManifest);
  assert.deepEqual(clips.map(clip => clip.id), ['opening', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5', 'voting', 'clue', 'caught', 'escaped-wrong', 'escaped-tie']);
  assert.equal(clips.length, 11); assert.equal(new Set(clips.map(clip => clip.src)).size, 11);
  const html = render('FilmGallery', { clips });
  assert.equal((html.match(/data-film-id=/g) ?? []).length, 11); assert.equal((html.match(/<video\b/g) ?? []).length, 1);
  assert.match(html, /<video[^>]*controls=""/); assert.match(html, /preload="metadata"/); assert.doesNotMatch(html, /autoplay/);
  assert.ok(html.includes('Ending spoilers')); assert.ok(html.includes('Open original MP4')); assert.ok(html.includes('00:18'));
  assert.ok(html.includes(clips[0].src.replaceAll('&', '&amp;')));
  assert.throws(() => developer.parseFilmLibrary({ version: 1, clips: [] }));
  assert.throws(() => developer.parseFilmLibrary({ version: 1, clips: (rawManifest as { clips: unknown[] }).clips.slice(0, 10) }));
});

test('native film preview uses the selected source and synchronized cue overlay in each caption language', () => {
  assert.ok(developer, 'Developer rehearsal UI must be implemented');
  const clips = developer.parseFilmLibrary(rawManifest);
  for (const captionLanguage of ['en', 'es', 'pt-BR'] as const) {
    const clip = clips.find(item => item.id === 'escaped-wrong')!;
    const html = render('FilmPreview', { clip, captionLanguage });
    const expected = captionLanguage === 'pt-BR' ? 'Um inocente leva a culpa.' : captionLanguage === 'es' ? 'Un inocente carga con la culpa.' : 'An innocent takes the blame.';
    assert.ok(html.includes(expected), captionLanguage); assert.match(html, /aria-live="off"/);
    assert.match(html, /<video[^>]*aria-label=/); assert.ok(html.includes(clip.src));
    assert.ok(html.includes('Read transcript')); assert.doesNotMatch(html, /autoplay/);
  }
});

test('developer entry, controls and gallery UI are available in all three languages', () => {
  const expectations = {
    es: ['Crear ensayo para un jugador', 'Biblioteca de películas', 'Iniciar ensayo', 'Cargando la biblioteca de películas…'],
    'pt-BR': ['Criar ensaio para um jogador', 'Biblioteca de filmes', 'Iniciar ensaio', 'Carregando a biblioteca de filmes…'],
  };
  for (const language of ['es', 'pt-BR'] as const) {
    const html = [render('DeveloperStart', { connected: true, creating: false, error: '', onCreate: async () => {} }, language), render('RehearsalControls', { room: view(), connected: true, command: async () => {} }, language), render('FilmLibrary', {}, language)].join('');
    for (const phrase of expectations[language]) assert.ok(html.includes(phrase), `${language}: ${phrase}`);
    assert.doesNotMatch(html, /Create one-player rehearsal|Loading the film library…|Start rehearsal/);
  }
});
