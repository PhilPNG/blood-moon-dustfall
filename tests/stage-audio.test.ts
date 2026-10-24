import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CinematicClip } from '../shared/cinematics';
import type { RoomView } from '../shared/types';
import { CinematicPlayer, CinematicVideo } from '../src/components/CinematicPlayer';
import { NarrationAudio, narrationPresentationBusy } from '../src/components/HostNarrator';
import { stageAudioEnabled } from '../src/components/stage-audio';
import { narrationCue, narrationPlayback, parseNarrationManifest } from '../shared/narration';
import { readFileSync } from 'node:fs';
import { attentionEventKey } from '../shared/attention';
import { LanguageProvider } from '../src/i18n';

const clip: CinematicClip = { id: 'clue', title: 'Shared evidence', src: '/media/clue.mp4', duration: 4, captions: {}, cues: { en: [], ptBR: [] } };
const room: RoomView = { code: 'SHOW', phase: 'investigation', round: 1, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: true, isMaster: false, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 0, stageSettings: { distanceMode: false, musicEnabled: false, musicVolume: 25 } };

test('a passive TV retains its Sound preference but every native film instance starts muted', () => {
  for (const mediaLeader of [false, true]) for (const sound of [false, true]) {
    const html = renderToStaticMarkup(createElement(CinematicVideo, { eventKey: 'film', clip, language: 'off', sound, mediaLeader, paused: false, onFinish() {} }));
    assert.equal(/<video\b[^>]*\bmuted=/.test(html), !(sound && mediaLeader), `leader=${mediaLeader}, preference=${sound}`);
  }
});

test('a passive TV explains all-audio authority in every language even when background music is disabled', () => {
  for (const [language, expected] of [['en', 'Game audio plays on the active TV.'], ['es', 'El audio del juego se reproduce en la TV activa.'], ['pt-BR', 'O áudio do jogo toca na TV ativa.']] as const) {
    const html = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(CinematicPlayer, { room, connected: true, sound: true, mediaLeader: false, toggleSound() {}, children: () => null }) }));
    assert.ok(html.includes(expected));
    assert.doesNotMatch(html, /Enable sound/);
  }
  const active = renderToStaticMarkup(createElement(CinematicPlayer, { room, connected: true, sound: true, mediaLeader: true, toggleSound() {}, children: () => null }));
  assert.doesNotMatch(active, /Game audio plays on the active TV/);
});

test('losing TV authority suspends and mutes a current narration without consuming or restarting its cue', () => {
  const clip = parseNarrationManifest(JSON.parse(readFileSync(new URL('../public/media/narration.json', import.meta.url), 'utf8'))).clips[0];
  const request = { phaseKey: 'same-phase', clipId: clip.id };
  const passive = narrationPlayback(request, 'same-phase', { connected: true, sound: stageAudioEnabled(true, false), paused: false, cinematicBlocked: false });
  assert.equal(passive.active, request); assert.equal(passive.suspended, true);
  assert.equal(narrationCue(room, { sound: stageAudioEnabled(true, false), blocked: false, phaseConsumed: false, timerConsumed: false, evidenceConsumed: false, evidenceReady: false, remaining: 300 }), null);
  const html = renderToStaticMarkup(createElement(NarrationAudio, { eventKey: 'same-narration', clip, fallback: 'Fallback', language: 'en', suspended: passive.suspended, onFinish() {} }));
  assert.match(html, /<audio\b[^>]*\bmuted=/);
  const resumed = narrationPlayback(request, 'same-phase', { connected: true, sound: stageAudioEnabled(true, true), paused: false, cinematicBlocked: false });
  assert.equal(resumed.active, request); assert.equal(resumed.suspended, false);
});

test('a passive TV explains silent film audio inside the cinematic overlay rather than only behind it', () => {
  const pending: RoomView = { ...room, serverNow: 100_000, attention: { id: 1, eventKey: attentionEventKey(room), cue: 'phase', endsAt: 110_000, remainingMs: 10_000 } };
  const html = renderToStaticMarkup(createElement(CinematicPlayer, { room: pending, connected: true, sound: true, mediaLeader: false, toggleSound() {}, children: () => null }));
  const overlay = html.slice(html.indexOf('<section class="cinema-overlay"'), html.indexOf('</section>', html.indexOf('<section class="cinema-overlay"')));
  assert.ok(overlay.includes('Game audio plays on the active TV.'));
  assert.match(overlay, /cinema-audio-authority--film/);
  assert.doesNotMatch(overlay, /> Enable sound/);
});

test('a suspended passive narrator keeps its request without holding the public visual stage busy', () => {
  const playing = { mediaLeader: true, active: true, requesting: false, sound: true, phaseConsumed: true };
  assert.equal(narrationPresentationBusy(playing), true);
  assert.equal(narrationPresentationBusy({ ...playing, mediaLeader: false }), false, 'spotlight and distance paging must release on the passive TV');
  assert.equal(narrationPresentationBusy({ ...playing, mediaLeader: true }), true, 'reacquiring authority can resume the same narrated request');
  assert.equal(narrationPresentationBusy({ ...playing, active: false }), false);
  assert.equal(narrationPresentationBusy({ ...playing, active: false, requesting: true }), true);
});
