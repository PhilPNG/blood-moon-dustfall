import { attentionRemainingMs } from '../shared/attention';
import type { RoomView } from '../shared/types';
import { useCountdown } from './useCountdown';

/** One authoritative deadline, sampled against a monotonic clock on each device. */
export function useAttentionCountdown(room: RoomView): number {
  const remainingMs = attentionRemainingMs(room);
  return useCountdown({
    endsAt: remainingMs > 0 ? room.attention?.endsAt ?? null : null,
    remaining: remainingMs / 1000,
    isPaused: room.attention?.endsAt == null,
  }, room.serverNow);
}
