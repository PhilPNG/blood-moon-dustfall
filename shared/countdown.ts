import type { RoomView } from './types.js';

export interface CountdownSample {
  remainingMs: number;
  sampledAt: number;
  running: boolean;
  delayMs?: number;
}

const nonnegativeFinite = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;

/** Anchor an authoritative server sample to a browser's monotonic clock. */
export function sampleCountdown(timer: RoomView['timer'], serverNow: number | undefined, monotonicNow: number): CountdownSample {
  const running = !timer.isPaused && timer.endsAt !== null;
  const delayMs = running && typeof serverNow === 'number' && Number.isFinite(serverNow)
    && typeof timer.startsAt === 'number' && Number.isFinite(timer.startsAt)
    ? nonnegativeFinite(timer.startsAt - serverNow) : 0;
  const remainingMs = running && typeof timer.endsAt === 'number' && Number.isFinite(timer.endsAt)
    && typeof serverNow === 'number' && Number.isFinite(serverNow)
    ? timer.endsAt - serverNow - delayMs
    : timer.remaining * 1000;
  return { remainingMs: nonnegativeFinite(remainingMs), sampledAt: nonnegativeFinite(monotonicNow), running, ...(delayMs ? { delayMs } : {}) };
}

/** Derive display seconds without consulting the device's wall clock. */
export function countdownSeconds(sample: CountdownSample, monotonicNow: number): number {
  const elapsedMs = sample.running ? nonnegativeFinite(monotonicNow - sample.sampledAt - (sample.delayMs ?? 0)) : 0;
  return Math.ceil(nonnegativeFinite(sample.remainingMs - elapsedMs) / 1000);
}
