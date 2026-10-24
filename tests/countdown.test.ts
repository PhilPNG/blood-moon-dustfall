import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownSeconds, sampleCountdown } from '../shared/countdown.js';
import type { RoomView } from '../shared/types.js';

const running = (endsAt: number, remaining = 300): RoomView['timer'] => ({ endsAt, remaining, isPaused: false });

test('a scheduled investigation clock holds through attention without displaying or charging its ten seconds', () => {
  const sample = sampleCountdown({ startsAt: 110_000, endsAt: 410_000, remaining: 300, isPaused: false }, 100_000, 5_000);
  assert.equal(countdownSeconds(sample, 5_000), 300);
  assert.equal(countdownSeconds(sample, 14_999), 300);
  assert.equal(countdownSeconds(sample, 15_000), 300);
  assert.equal(countdownSeconds(sample, 16_000), 299);
  const refreshed = sampleCountdown({ startsAt: 110_000, endsAt: 410_000, remaining: 300, isPaused: false }, 109_500, 20_000);
  assert.equal(countdownSeconds(refreshed, 21_499), 300);
  assert.equal(countdownSeconds(refreshed, 21_500), 299);
});

test('a running countdown uses the server deadline and monotonic elapsed time', () => {
  const sample = sampleCountdown(running(400_000), 100_000, 5_000);
  assert.equal(countdownSeconds(sample, 5_000), 300);
  assert.equal(countdownSeconds(sample, 6_000), 299);
  assert.equal(countdownSeconds(sample, 7_001), 298);
  assert.equal(countdownSeconds(sample, 8_000), 297, 'reading a sample does not restart its elapsed time');
});

test('fractional server time rounds up only after subtracting elapsed milliseconds', () => {
  const sample = sampleCountdown(running(400_000), 100_100, 5_000);
  assert.equal(countdownSeconds(sample, 5_000), 300);
  assert.equal(countdownSeconds(sample, 5_899), 300);
  assert.equal(countdownSeconds(sample, 5_900), 299);
  assert.equal(countdownSeconds(sample, 6_899), 299);
  assert.equal(countdownSeconds(sample, 6_900), 298);
});

test('an expired countdown stays at zero', () => {
  const sample = sampleCountdown(running(101_000), 100_000, 20);
  assert.equal(countdownSeconds(sample, 1_019), 1);
  assert.equal(countdownSeconds(sample, 1_020), 0);
  assert.equal(countdownSeconds(sample, 999_999), 0);
  assert.equal(countdownSeconds(sampleCountdown(running(99_000), 100_000, 20), 20), 0);
});

test('paused and untimed countdowns stay fixed at the supplied remaining time', () => {
  for (const timer of [
    { endsAt: 400_000, remaining: 184, isPaused: true },
    { endsAt: null, remaining: 42, isPaused: false },
    { endsAt: 0, remaining: 17, isPaused: true },
  ]) {
    const sample = sampleCountdown(timer, 100_000, 5_000);
    assert.equal(countdownSeconds(sample, 5_000), timer.remaining);
    assert.equal(countdownSeconds(sample, 905_000), timer.remaining);
  }
});

test('legacy snapshots without server time start from remaining and still count down', () => {
  const sample = sampleCountdown(running(999_999, 73), undefined, 5_000);
  assert.equal(countdownSeconds(sample, 5_000), 73);
  assert.equal(countdownSeconds(sample, 5_999), 73);
  assert.equal(countdownSeconds(sample, 6_000), 72);
  assert.equal(countdownSeconds(sample, 90_000), 0);
});

test('invalid timestamp fields fall back to remaining without producing invalid output', () => {
  for (const [endsAt, serverNow] of [[NaN, 100_000], [Infinity, 100_000], [400_000, NaN], [400_000, Infinity]]) {
    const sample = sampleCountdown(running(endsAt, 17), serverNow, 5_000);
    assert.equal(countdownSeconds(sample, 5_000), 17);
    assert.equal(countdownSeconds(sample, 6_000), 16);
  }
  assert.equal(countdownSeconds(sampleCountdown(running(0), 0, 5_000), 5_000), 0, 'zero is a valid timestamp');
});

test('negative and non-finite remaining values display zero', () => {
  for (const remaining of [-2, NaN, Infinity, -Infinity]) {
    for (const timer of [running(999_999, remaining), { endsAt: null, remaining, isPaused: false }, { endsAt: 400_000, remaining, isPaused: true }]) {
      assert.equal(countdownSeconds(sampleCountdown(timer, undefined, 5_000), 5_000), 0);
    }
  }
});

test('a fresh server snapshot reanchors extensions, pause, resume and the next act', () => {
  const original = sampleCountdown(running(400_000), 100_000, 5_000);
  assert.equal(countdownSeconds(original, 15_000), 290);
  const extended = sampleCountdown(running(460_000, 350), 110_000, 15_000);
  assert.equal(countdownSeconds(extended, 15_000), 350);
  assert.equal(countdownSeconds(extended, 20_000), 345);
  const paused = sampleCountdown({ endsAt: null, remaining: 345, isPaused: true }, 115_000, 20_000);
  assert.equal(countdownSeconds(paused, 50_000), 345);
  const resumed = sampleCountdown(running(490_000, 345), 145_000, 50_000);
  assert.equal(countdownSeconds(resumed, 55_000), 340);
  const nextAct = sampleCountdown(running(750_000), 150_000, 55_000);
  assert.equal(countdownSeconds(nextAct, 55_000), 600);
});

test('a fresh sample corrects elapsed time after reconnect without reusing the old anchor', () => {
  const original = sampleCountdown(running(400_000), 100_000, 5_000);
  assert.equal(countdownSeconds(original, 15_000), 290);
  const refreshed = sampleCountdown(running(400_000, 288), 112_000, 15_000);
  assert.equal(countdownSeconds(refreshed, 15_000), 288);
  assert.equal(countdownSeconds(refreshed, 16_000), 287);
});

test('countdown results ignore wall-clock jumps in either direction', () => {
  const originalNow = Date.now;
  try {
    for (const wallNow of [-86_400_000, 86_400_000_000]) {
      Date.now = () => wallNow;
      const sample = sampleCountdown(running(400_000), 100_000, 5_000);
      assert.equal(countdownSeconds(sample, 5_000), 300);
      Date.now = () => -wallNow;
      assert.equal(countdownSeconds(sample, 10_000), 295);
    }
  } finally {
    Date.now = originalNow;
  }
});

test('a backwards or invalid monotonic reading cannot add time or produce an invalid value', () => {
  const sample = sampleCountdown(running(400_000), 100_000, 5_000);
  for (const reading of [4_000, NaN, Infinity, -Infinity]) assert.equal(countdownSeconds(sample, reading), 300);
});
