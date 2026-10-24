import type { MediaPlaybackReport, RoomView } from './types.js';
import { cinematicEvent } from './cinematics.js';
import { narrationEvent } from './narration.js';
import { preflightEvent } from './stage-presentation.js';

export const DISPLAY_LEASE_MS = 8_000;
export const DISPLAY_CAPABILITY_MS = 15 * 60_000;
export const PLAYBACK_STALE_MS = 10_000;
/** Produced media lengths: validation never trusts a duration supplied by a public display. */
export const MEDIA_DURATIONS = {
  film: { opening: 18.042, 'act-1': 8.064, 'act-2': 8.064, 'act-3': 8.064, 'act-4': 6.042, 'act-5': 6.042, voting: 6.042, clue: 4.042, caught: 8.042, 'escaped-wrong': 8.042, 'escaped-tie': 8.042 },
  narration: { lobby: 16.536, roles: 19.879, 'act-1': 17.789, 'act-2': 16.3, 'act-3': 14.367, 'act-4': 14.289, 'act-5': 15.647, voting: 16.039, caught: 17.502, 'escaped-wrong': 15.647, 'escaped-tie': 15.752, 'timer-warning': 10.789, evidence: 10.057 },
} as const;

/** Presentation controls and clock interruptions retire reports without changing film/history identity. */
export function playbackEventKey(room: RoomView, key: string): string {
  const phaseKey = cinematicEvent(room)?.key ?? narrationEvent(room).key;
  const serial = room.presentation?.eventKey === phaseKey ? room.presentation.serial : 0;
  const take = serial ? `${key}:presentation:${serial}` : key;
  return room.playbackEpoch ? `${take}:clock:${room.playbackEpoch}` : take;
}

export function playbackMatchesRoom(room: RoomView, playback: MediaPlaybackReport): boolean {
  const preflight = preflightEvent(room);
  if (preflight && playback.kind === 'film' && playback.clipId === 'clue' && playback.eventKey === playbackEventKey(room, preflight.key)) return true;
  const film = cinematicEvent(room);
  if (playback.kind === 'film') return !!film && playback.eventKey === playbackEventKey(room, film.key) && (playback.clipId === film.clipId || (room.phase === 'investigation' && playback.clipId === 'clue'));
  if (playback.kind !== 'narration' || room.masterReady === false) return false;
  const event = narrationEvent(room);
  return playback.eventKey === playbackEventKey(room, `${event.key}:narration:${playback.clipId}`) && (playback.clipId === event.clipId || (room.phase === 'investigation' && ['timer-warning', 'evidence'].includes(playback.clipId)));
}

/** `now` is server time estimated from the latest serverNow sample, never the phone's wall clock. */
export function playbackPosition(room: RoomView, connected: boolean, now: number): number | null {
  const playback = room.playback;
  if (!connected || room.timer.isPaused || !playback?.playing || !playbackMatchesRoom(room, playback)) return null;
  const age = Math.max(0, now - playback.updatedAt);
  if (age >= PLAYBACK_STALE_MS) return null;
  const durations = MEDIA_DURATIONS[playback.kind] as Record<string, number>;
  const duration = durations[playback.clipId];
  if (!duration) return null;
  const position = playback.position + age / 1000;
  return position < duration ? Math.max(0, position) : null;
}
