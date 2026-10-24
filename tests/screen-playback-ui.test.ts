import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { Master } from '../src/components/Master';
import { LanguageProvider, translate } from '../src/i18n';
import { cinematicEvent } from '../shared/cinematics';
import { playbackEventKey } from '../shared/media-sync';
import type { RoomView } from '../shared/types';
import type { Language } from '../shared/locale';

function room(): RoomView {
  const view: RoomView = { code: 'SHOW', gameId: 'screen-test', phase: 'roles', round: 0, serverNow: 100_000, masterReady: true, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: true, timer: { endsAt: null, remaining: 0, isPaused: false }, clues: [], votesCount: 0, isMaster: true };
  view.playback = { kind: 'film', clipId: 'opening', eventKey: playbackEventKey(view, cinematicEvent(view)!.key), position: 3, playing: true, updatedAt: 100_000, displayId: 'public-tv' };
  return view;
}
function render(view: RoomView, language: Language = 'en', connected = true) {
  return renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(Master, { room: view, connected, command: async () => {}, joinOrigin: 'https://alibi.example', onHome: () => {} }) }));
}
function monitor(html: string) {
  const card = html.match(/<section[^>]*class="gm-card gm-media-status"[^>]*>[\s\S]*?<\/section>/)?.[0];
  assert.ok(card, 'GM phone must show its silent public-playback monitor');
  return card;
}

test('the private GM phone shows native film progress without starting its own media', () => {
  const html = render(room()), card = monitor(html);
  for (const text of ['On the big screen', 'Story film', 'Blood Moon over Dustfall', 'Playing', '00:03', '00:18']) assert.ok(card.includes(text), text);
  assert.match(card, /role="progressbar"/);
  assert.match(card, /aria-label="Public presentation progress"/);
  assert.doesNotMatch(html, /<audio\b|<video\b/);
});

test('live playback labels and authored clip titles localize on the GM phone', () => {
  const expected = {
    es: ['En la pantalla grande', 'Película de la historia', 'Luna de sangre sobre Dustfall', 'En reproducción'],
    'pt-BR': ['Na tela grande', 'Filme da história', 'Lua de sangue sobre Dustfall', 'Reproduzindo'],
  };
  for (const language of ['es', 'pt-BR'] as const) {
    const card = monitor(render(room(), language));
    for (const label of expected[language]) assert.ok(card.includes(label), `${language}: ${label}`);
    assert.doesNotMatch(card, />Playing<|>Story film<|Blood Moon over Dustfall/);
  }
});

test('paused, offline and retired reports show no misleading live progress', () => {
  const paused = room(); paused.timer.isPaused = true;
  const stale = room(); stale.serverNow = 110_000;
  for (const [view, connected, state] of [[paused, true, 'paused'], [room(), false, 'offline'], [stale, true, 'standby']] as const) {
    const card = monitor(render(view, 'en', connected));
    assert.ok(card.includes(`data-status="${state}"`));
    assert.doesNotMatch(card, /role="progressbar"|Blood Moon over Dustfall/);
  }
  const ended = room(); ended.playback!.playing = false; ended.playback!.position = 18.042;
  const card = monitor(render(ended));
  assert.ok(card.includes('Finished'));
  assert.ok(card.includes('The film has finished. The narrator may speak next.'));
});

test('all twenty-four existing media titles and monitor messages have Spanish and Portuguese copy', () => {
  const titles = ['cinematics', 'narration'].flatMap(file => JSON.parse(readFileSync(new URL(`../public/media/${file}.json`, import.meta.url), 'utf8')).clips.map((clip: { title: string }) => clip.title));
  const messages = ['On the big screen', 'Public screen playback', 'Public presentation progress', 'Story film', 'Narrator', 'Playing', 'On hold', 'Finished', 'Standby', 'No recent playback', 'The public screen is paused or loading.', 'The film has finished. The narrator may speak next.', 'The announcement has finished. You decide the next move.', 'Progress appears here when the public screen plays a film or narration.', 'Resume the game to continue the public presentation.', 'Waiting to reconnect before showing live playback.', 'Let films and narration finish before advancing.', '{elapsed} of {duration}'];
  for (const source of [...titles, ...messages]) for (const language of ['es', 'pt-BR'] as const) assert.notEqual(translate(language, source), source, `${language}: ${source}`);
});
