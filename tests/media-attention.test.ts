import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { attentionEventKey } from '../shared/attention';
import type { RoomView } from '../shared/types';
import { attentionClueId, attentionPermitReleased, attentionRequestPayload, filmHistoryKey, groupedNarrationCue, resumeClueAttention, skipCluePresentation, withAttentionReceipt } from '../src/components/media-attention';
import { cinematicEvent, CinematicHistory, syncClueCue } from '../shared/cinematics';
import { GameEngine } from '../server/engine';
import { Display } from '../src/components/Display';

const view = (patch: Partial<RoomView> = {}): RoomView => ({ code: 'SHOW', gameId: 'game-one', actionEpoch: 2, serverNow: 100_000, revision: 4, phase: 'investigation', round: 1, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: true, isMaster: false, timer: { endsAt: 400_000, remaining: 300, isPaused: false }, clues: [], votesCount: 0, ...patch });
const cue = (room: RoomView, id = 1) => ({ id, eventKey: attentionEventKey(room), cue: 'clue' as const, endsAt: 110_000, remainingMs: 10_000 });

test('public cue requests contain the observed context and published clue id without private dossiers', () => {
  const room = view({ me: { playerId: 'private-seat', clues: [], ready: true, votedFor: 'secret-vote', role: { name: 'Private role', gender: 'man', alignment: 'culprit', brief: 'Secret brief', objective: 'Secret objective' } }, presentation: { serial: 3, eventKey: 'game-one:investigation:1', control: 'replay' } });
  assert.deepEqual(attentionRequestPayload(room, 'screen-one', 'display-token', 'clue', 'published-clue'), {
    code: 'SHOW', displayId: 'screen-one', token: 'display-token', eventKey: 'game-one:investigation:1:attention:2:presentation:3', cue: 'clue',
    context: { gameId: 'game-one', phase: 'investigation', round: 1, actionEpoch: 2 }, presentationSerial: 3, clueId: 'published-clue',
  });
});

test('a later real clue claims successfully when a rehearsal already has published sample clues', () => {
  let now = 100_000;
  const engine = new GameEngine({ now: () => now }), master = engine.create({ rehearsal: true });
  const guest = engine.join({ code: master.code, name: 'Real guest', gender: 'any' });
  const command = (action: unknown, token = master.token) => engine.command(master.code, token, action);
  command({ type: 'demo-fill' }); command({ type: 'start' }); command({ type: 'advance' });
  const before = engine.view(master.code), phase = cinematicEvent(before)!;
  const baselineIds = before.clues.filter(clue => clue.published).map(clue => clue.id);
  assert.equal(baselineIds.length, 4);
  const state = syncClueCue(undefined, phase.key, baselineIds, true).state;
  now = 111_000;
  const realClue = engine.view(master.code, guest.token).me!.clues[0];
  command({ type: 'publish-clue', clueId: realClue.id }, guest.token);
  const room = engine.view(master.code);
  const id = attentionClueId(state, [...baselineIds, realClue.id]);
  assert.equal(id, realClue.id, 'the sample baseline cannot stand in for the newly shared clue');
  const cap = engine.claimDisplay(master.code, 'mixed-test-tv');
  const { code: _code, displayId: _display, token: _token, ...payload } = attentionRequestPayload(room, 'mixed-test-tv', cap.token!, 'clue', id);
  assert.equal(engine.claimAttention(master.code, 'mixed-test-tv', cap.token, payload).attention.cue, 'clue');
  const updated = syncClueCue(state, phase.key, [...baselineIds, realClue.id], true).state;
  assert.equal(attentionClueId(updated, [...baselineIds, realClue.id], id), realClue.id, 'waiting for phase narration must retain the eligible id');
});

test('refresh during or just after a claimed clue countdown resumes its unconsumed sequence without another claim', () => {
  const room = view(); room.attention = cue(room, 4);
  const phase = cinematicEvent(room)!;
  const baseline = syncClueCue(undefined, phase.key, ['already-public'], true).state;
  const resumed = resumeClueAttention(room, baseline, ['already-public'], false);
  assert.ok(resumed);
  assert.equal(resumed.state.pending, true);
  assert.equal(syncClueCue(resumed.state, phase.key, ['already-public'], true).play, false);
  assert.equal(attentionPermitReleased(room, resumed.permit, `${phase.key}:clue`, 10), false);
  assert.equal(syncClueCue(resumed.state, phase.key, ['already-public'], false).play, true);
  assert.equal(attentionPermitReleased(room, resumed.permit, `${phase.key}:clue`, 0), true);
  assert.equal(resumeClueAttention({ ...room, serverNow: 112_000 }, baseline, ['already-public'], false)?.permit.id, 4);
  assert.equal(resumeClueAttention(room, baseline, ['already-public'], true), undefined, 'a completed local sequence must stay deduped');
});

test('GM skip during a clue countdown skips its queued film while preserving its countdown and evidence voice', () => {
  const room = view({ presentation: { eventKey: 'game-one:investigation:1', serial: 2, control: 'skip' } });
  room.attention = cue(room, 7);
  const phase = cinematicEvent(room)!;
  const history = new CinematicHistory();
  const queued = { ...syncClueCue(undefined, phase.key, ['shared-clue'], true).state, pending: true };
  const before = structuredClone(room.attention);
  const skipped = skipCluePresentation(room, queued, history);
  assert.ok(skipped);
  assert.equal(skipped.eventKey, phase.key, 'the current evidence narration becomes ready');
  assert.equal(history.has(`${phase.key}:clue`), true, 'the queued clue film cannot return after the countdown');
  assert.equal(history.has(`${phase.key}:narration:evidence`), false, 'skipping the film preserves its following voice');
  assert.equal(syncClueCue(skipped.state, phase.key, ['shared-clue'], false).play, false);
  assert.deepEqual(room.attention, before, 'skip must preserve the existing countdown id and deadline');
  const next = view({ round: 2 }), nextKey = cinematicEvent(next)!.key;
  assert.equal(history.has(`${nextKey}:clue`), false);
  const nextState = syncClueCue(undefined, nextKey, [], false).state;
  assert.equal(syncClueCue(nextState, nextKey, ['next-act-clue'], false).play, true);
  assert.equal(skipCluePresentation({ ...room, attention: { ...room.attention, cue: 'phase' } }, queued, history), undefined, 'an unrelated phase-film skip cannot consume a future clue');
});

test('an incidental claim gates immediately before polling while later authoritative state wins', () => {
  const room = view();
  const receipt = { attention: cue(room), serverNow: 101_000 };
  assert.equal(withAttentionReceipt(room, receipt).attention?.id, 1);
  const newer = view({ serverNow: 102_000, revision: 5, attention: { ...cue(room), endsAt: null, remainingMs: 8_000 }, timer: { endsAt: null, remaining: 300, isPaused: true } });
  assert.equal(withAttentionReceipt(newer, receipt), newer, 'a late claim cannot overwrite the subsequent paused cue');
  const next = view({ phase: 'investigation', round: 2 });
  assert.equal(withAttentionReceipt(next, receipt), next, 'a previous act cannot install its countdown after Next');
  const reset = view({ gameId: undefined, phase: 'lobby', round: 0, actionEpoch: 3 });
  assert.equal(withAttentionReceipt(reset, receipt), reset);
});

test('incidental audio waits for its own released cue and an extended warning cannot reuse a canceled permit', () => {
  const room = view(); room.attention = { ...cue(room, 3), cue: 'timer-warning' };
  const permit = { key: 'warning', eventKey: attentionEventKey(room), id: 3 };
  assert.equal(attentionPermitReleased(room, permit, 'warning', 10), false);
  assert.equal(attentionPermitReleased(room, permit, 'warning', 0), true);
  assert.equal(attentionPermitReleased({ ...room, timer: { ...room.timer, isPaused: true } }, permit, 'warning', 0), false);
  assert.equal(attentionPermitReleased({ ...room, attention: undefined }, permit, 'warning', 0), false);
  assert.equal(attentionPermitReleased({ ...room, attention: { ...room.attention, id: 4 } }, permit, 'warning', 0), false);
  assert.equal(attentionPermitReleased(room, permit, 'different-cue', 0), false);
  const extended = { ...room, attention: undefined, timer: { ...room.timer, remaining: 90 } };
  const futureWarning = { ...extended, timer: { ...extended.timer, remaining: 30 } };
  assert.equal(attentionPermitReleased(futureWarning, permit, 'warning', 0), false, 'the later thirty-second boundary still requires a fresh attention claim');
});

test('a clue film and its evidence narration finish as one sequence before a timer warning may claim', () => {
  const room = view();
  const options = { sound: true, blocked: false, phaseConsumed: true, timerConsumed: false, evidenceConsumed: false, evidenceReady: true, remaining: 30 };
  assert.equal(groupedNarrationCue(room, options)?.clipId, 'evidence');
  assert.equal(groupedNarrationCue(room, { ...options, evidenceConsumed: true })?.clipId, 'timer-warning');
});

test('a fresh thirty-second warning is omitted once it is late and remains eligible after extension', () => {
  const room = view();
  const options = { sound: true, blocked: false, phaseConsumed: true, timerConsumed: false, evidenceConsumed: true, evidenceReady: false, remaining: 30 };
  for (const [remaining, expected] of [[31, undefined], [30, 'timer-warning'], [29, 'timer-warning'], [28, undefined], [20, undefined], [0, undefined]] as const) {
    assert.equal(groupedNarrationCue(room, { ...options, remaining })?.clipId, expected, `${remaining} seconds`);
  }
  assert.equal(groupedNarrationCue(room, { ...options, remaining: 90 }), null);
  assert.equal(groupedNarrationCue(room, { ...options, remaining: 30 })?.clipId, 'timer-warning', 'omission must not consume a future warning');
});

test('an already accepted warning remains eligible at its held time after a refresh while canceled cues do not', () => {
  const room = view(); room.attention = { ...cue(room, 5), cue: 'timer-warning' };
  const options = { sound: true, blocked: false, phaseConsumed: true, timerConsumed: false, evidenceConsumed: true, evidenceReady: false, remaining: 28 };
  assert.equal(groupedNarrationCue(room, options)?.clipId, 'timer-warning', 'the server already granted this presentation at its allowed twenty-eight-second boundary');
  assert.equal(groupedNarrationCue({ ...room, attention: undefined }, options), null);
  assert.equal(groupedNarrationCue({ ...room, round: 2 }, options), null, 'a retired cue cannot authorize a fresh late warning');
  assert.equal(groupedNarrationCue(room, { ...options, timerConsumed: true }), null, 'completed warning history still deduplicates it');
});

test('a requested replay has its own viewed history while a pause preserves the same take', () => {
  const room = view({ phase: 'roles', round: 0 });
  const event = 'game-one:roles:0';
  const history = new CinematicHistory(); history.claim(filmHistoryKey(room, event));
  const replay = { ...room, presentation: { serial: 1, eventKey: event, control: 'replay' as const } };
  assert.equal(history.has(filmHistoryKey(replay, event)), false, 'a previous film cannot consume the new replay before its countdown finishes');
  history.claim(filmHistoryKey(replay, event));
  assert.equal(history.has(filmHistoryKey({ ...replay, playbackEpoch: 2 }, event)), true, 'pause/resume must not replay the film');
});

test('the host conceals the verdict and its first film frame throughout an active countdown', () => {
  const room = view({ phase: 'results', round: 3, masterReady: true, result: { culpritId: 'killer', caught: true, tallies: { killer: 1 }, solution: { headline: 'ANSWER SPOILER', summary: 'SECRET METHOD', method: 'Induction coil', motive: 'The auction', timeline: [] } } });
  room.attention = { ...cue(room), cue: 'phase' };
  const html = renderToStaticMarkup(createElement(Display, { room, connected: true, joinOrigin: 'https://example.test' }));
  assert.match(html, /attention--host/);
  assert.doesNotMatch(html, /ANSWER SPOILER|SECRET METHOD|Culprit revealed|<video/);
  assert.match(html, /The truth is coming/);
  assert.match(html, /Replay films from the game master/);
  assert.doesNotMatch(html, /aria-label="Replay current story film"/);
});
