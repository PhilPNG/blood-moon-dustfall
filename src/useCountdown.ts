import { useEffect, useRef, useState } from 'react';
import { countdownSeconds, sampleCountdown, type CountdownSample } from '../shared/countdown.js';
import type { RoomView } from '../shared/types.js';

interface CountdownAnchor {
  endsAt: RoomView['timer']['endsAt'];
  startsAt: RoomView['timer']['startsAt'];
  remaining: number;
  isPaused: boolean;
  serverNow: number | undefined;
  sample: CountdownSample;
}

const monotonicNow = (): number => typeof performance === 'undefined' ? 0 : performance.now();

export function useCountdown(timer: RoomView['timer'], serverNow?: number): number {
  const anchor = useRef<CountdownAnchor | null>(null);
  const [, setTick] = useState(0);
  const { endsAt, startsAt, remaining, isPaused } = timer;
  const previous = anchor.current;
  if (!previous || !Object.is(previous.endsAt, endsAt) || !Object.is(previous.startsAt, startsAt) || !Object.is(previous.remaining, remaining)
    || previous.isPaused !== isPaused || !Object.is(previous.serverNow, serverNow)) {
    anchor.current = { endsAt, startsAt, remaining, isPaused, serverNow, sample: sampleCountdown(timer, serverNow, monotonicNow()) };
  }
  const sample = anchor.current!.sample;
  const seconds = countdownSeconds(sample, monotonicNow());
  const running = sample.running && seconds > 0;

  useEffect(() => {
    if (!running) return;
    const refresh = () => setTick(value => value + 1);
    const interval = setInterval(refresh, 250);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [running]);

  return seconds;
}
