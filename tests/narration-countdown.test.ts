import test from 'node:test';
import assert from 'node:assert/strict';
import { CinematicHistory } from '../shared/cinematics.js';
import { countdownSeconds, sampleCountdown } from '../shared/countdown.js';
import { narrationCue, narrationEvent, type NarrationCueOptions } from '../shared/narration.js';
import type { RoomView } from '../shared/types.js';

const investigation = (patch: Partial<RoomView> = {}): RoomView => ({
  code: 'TIME', gameId: 'clock-game', phase: 'investigation', round: 1, serverNow: 1_000_000,
  settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 },
  players: [], isLocked: true, isMaster: true, clues: [], votesCount: 0,
  timer: { endsAt: 1_031_000, remaining: 31, isPaused: false },
  ...patch,
});
const ready: Omit<NarrationCueOptions, 'remaining'> = {
  sound: true, blocked: false, phaseConsumed: true, timerConsumed: false,
  evidenceConsumed: false, evidenceReady: false,
};

test('narration reaches the thirty-second warning with the visible countdown despite wall-clock skew', t => {
  const room = investigation();
  let wallTime = room.serverNow!;
  t.mock.method(Date, 'now', () => wallTime);

  for (const skew of [-21_600_000, 21_600_000]) {
    wallTime = room.serverNow! + skew;
    const sample = sampleCountdown(room.timer, room.serverNow, 5_000);
    const beforeBoundary = countdownSeconds(sample, 5_999);
    assert.equal(beforeBoundary, 31);
    assert.equal(narrationCue(room, { ...ready, remaining: beforeBoundary }), null);

    wallTime = room.serverNow! - skew;
    const atBoundary = countdownSeconds(sample, 6_000);
    assert.equal(atBoundary, 30);
    assert.equal(narrationCue(room, { ...ready, remaining: atBoundary })?.clipId, 'timer-warning');
    assert.equal(narrationCue(room, { ...ready, remaining: countdownSeconds(sample, 35_000) })?.clipId, 'timer-warning');
    assert.equal(narrationCue(room, { ...ready, remaining: countdownSeconds(sample, 36_000) }), null, 'an expired act cannot announce time remaining');
  }
});

test('pause, extension, resume and the next act immediately change the countdown supplied to narration', () => {
  const running = investigation();
  const paused = investigation({ serverNow: 1_001_000, timer: { endsAt: null, remaining: 30, isPaused: true } });
  const pausedSample = sampleCountdown(paused.timer, paused.serverNow, 6_000);
  assert.equal(countdownSeconds(pausedSample, 96_000), 30);
  assert.equal(narrationCue(paused, { ...ready, remaining: countdownSeconds(pausedSample, 96_000) }), null);

  const extended = { ...paused, timer: { ...paused.timer, remaining: 90 } };
  const extendedSample = sampleCountdown(extended.timer, extended.serverNow, 96_000);
  assert.equal(countdownSeconds(extendedSample, 156_000), 90);
  assert.equal(narrationCue(extended, { ...ready, remaining: countdownSeconds(extendedSample, 156_000) }), null);

  const resumed = investigation({ serverNow: 1_151_000, timer: { endsAt: 1_241_000, remaining: 90, isPaused: false } });
  const resumedSample = sampleCountdown(resumed.timer, resumed.serverNow, 156_000);
  assert.equal(narrationCue(resumed, { ...ready, remaining: countdownSeconds(resumedSample, 156_000) }), null);
  assert.equal(narrationCue(resumed, { ...ready, remaining: countdownSeconds(resumedSample, 216_000) })?.clipId, 'timer-warning');

  const nextAct = investigation({ round: 2, serverNow: 1_211_000, timer: { endsAt: 1_511_000, remaining: 300, isPaused: false } });
  const nextSample = sampleCountdown(nextAct.timer, nextAct.serverNow, 216_000);
  assert.equal(countdownSeconds(nextSample, 216_000), 300);
  assert.equal(narrationCue(nextAct, { ...ready, phaseConsumed: false, remaining: countdownSeconds(nextSample, 216_000) })?.clipId, 'act-2');
  assert.equal(narrationCue(nextAct, { ...ready, remaining: countdownSeconds(nextSample, 216_000) }), null);
  assert.notEqual(narrationEvent(running).key, narrationEvent(nextAct).key);
});

test('a claimed warning stays consumed after extension while the next act has its own warning', () => {
  const history = new CinematicHistory();
  const firstAct = investigation();
  const firstSample = sampleCountdown(firstAct.timer, firstAct.serverNow, 5_000);
  const warning = narrationCue(firstAct, {
    ...ready, phaseConsumed: false, evidenceReady: true,
    remaining: countdownSeconds(firstSample, 6_000),
  });
  assert.equal(warning?.clipId, 'timer-warning', 'the warning retains priority over unconsumed act and evidence cues');
  assert.equal(history.claim(warning!.key), true);
  assert.equal(history.claim(warning!.key), false);

  const extended = investigation({ serverNow: 1_001_000, timer: { endsAt: 1_091_000, remaining: 90, isPaused: false } });
  const extendedSample = sampleCountdown(extended.timer, extended.serverNow, 6_000);
  for (const at of [6_000, 66_000, 67_000]) {
    assert.equal(narrationCue(extended, {
      ...ready, timerConsumed: history.has(warning!.key),
      remaining: countdownSeconds(extendedSample, at),
    }), null, 'returning below thirty seconds cannot replay this act’s warning');
  }

  const nextAct = investigation({ round: 2 });
  const nextSample = sampleCountdown(nextAct.timer, nextAct.serverNow, 66_000);
  const nextWarning = narrationCue(nextAct, {
    ...ready,
    timerConsumed: history.has(`${narrationEvent(nextAct).key}:narration:timer-warning`),
    remaining: countdownSeconds(nextSample, 67_000),
  });
  assert.equal(nextWarning?.clipId, 'timer-warning');
  assert.notEqual(nextWarning!.key, warning!.key);
  assert.equal(history.claim(nextWarning!.key), true);
});
