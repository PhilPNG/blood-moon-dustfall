import type { RoomView } from './types.js';

type AttentionRoom = Pick<RoomView, 'code' | 'phase' | 'round'> & Partial<Pick<RoomView, 'gameId' | 'actionEpoch' | 'presentation' | 'attention' | 'serverNow'>>;

/** Pause changes the media clock, never the identity of an audience cue. */
export function attentionEventKey(room: AttentionRoom): string {
  const phase = `${room.gameId ?? `legacy-${room.code}`}:${room.phase}:${room.round}`;
  const serial = room.presentation?.eventKey === phase ? room.presentation.serial : 0;
  return `${phase}:attention:${room.actionEpoch ?? 0}:presentation:${serial}`;
}

/** Estimate server time with the caller's monotonic anchor when animating between polls. */
export function attentionRemainingMs(room: AttentionRoom, now = room.serverNow ?? Date.now()): number {
  const cue = room.attention;
  if (!cue || cue.eventKey !== attentionEventKey(room)) return 0;
  const remaining = cue.endsAt === null ? cue.remainingMs : cue.endsAt - now;
  return Number.isFinite(remaining) ? Math.max(0, Math.min(10_000, remaining)) : 0;
}

export function attentionActive(room: AttentionRoom, now?: number): boolean {
  return attentionRemainingMs(room, now) > 0;
}
