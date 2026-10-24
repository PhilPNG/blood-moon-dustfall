import type { CinematicId } from './cinematics.js';
import type { NarrationId } from './narration.js';
import { MEDIA_DURATIONS, playbackMatchesRoom, PLAYBACK_STALE_MS } from './media-sync.js';
import type { RoomView } from './types.js';

/** Authored public titles only; monitoring never needs media URLs or caption payloads. */
export const MEDIA_TITLES = {
  film: {
    opening: 'Blood Moon over Dustfall',
    'act-1': 'A Shot in the Eclipse',
    'act-2': 'The Black Star Bargain',
    'act-3': 'What the Lantern Kept',
    'act-4': 'The Minute Between',
    'act-5': 'Before the Last Bell',
    voting: 'Sealed Accusations',
    clue: 'A New Lead',
    caught: 'The Truth Holds',
    'escaped-wrong': 'An Innocent Blamed',
    'escaped-tie': 'A Town Divided',
  },
  narration: {
    lobby: 'Welcome to Dustfall',
    roles: 'Your secret identity',
    'act-1': 'First investigation',
    'act-2': 'Follow the bargain',
    'act-3': 'Match the seal',
    'act-4': 'Reconstruct the crime',
    'act-5': 'Make your final case',
    voting: 'Seal your accusation',
    caught: 'Justice in Dustfall',
    'escaped-wrong': 'The wrong trail',
    'escaped-tie': 'A divided verdict',
    'timer-warning': 'Thirty seconds remain',
    evidence: 'A clue hits the board',
  },
} as const satisfies { film: Record<CinematicId, string>; narration: Record<NarrationId, string> };

export type ScreenPlayback =
  | { status: 'standby' }
  | { status: 'offline' }
  | { status: 'paused' }
  | {
    status: 'playing' | 'holding' | 'complete';
    kind: 'film' | 'narration';
    clipId: string;
    title: string;
    position: number;
    duration: number;
    progress: number;
  };

/** `now` is estimated server time anchored to a monotonic browser sample. */
export function screenPlayback(room: RoomView, connected: boolean, now: number): ScreenPlayback {
  if (!connected) return { status: 'offline' };
  if (room.timer.isPaused) return { status: 'paused' };

  const playback = room.playback;
  if (!playback || !Number.isFinite(room.serverNow) || !Number.isFinite(now)
    || !Number.isFinite(playback.updatedAt) || !Number.isFinite(playback.position)
    || typeof playback.playing !== 'boolean'
    || (playback.kind !== 'film' && playback.kind !== 'narration')
    || !playbackMatchesRoom(room, playback)) return { status: 'standby' };

  const age = Math.max(0, now - playback.updatedAt);
  const titles: Record<string, string> = MEDIA_TITLES[playback.kind];
  const durations: Record<string, number> = MEDIA_DURATIONS[playback.kind];
  if (age >= PLAYBACK_STALE_MS || !Object.hasOwn(titles, playback.clipId) || !Object.hasOwn(durations, playback.clipId)) return { status: 'standby' };

  const duration = durations[playback.clipId];
  const position = Math.min(duration, Math.max(0, playback.position + (playback.playing ? age / 1000 : 0)));
  // Only a stopped native sample can establish that media reached its end.
  const status = playback.playing ? 'playing' : position >= duration - .15 ? 'complete' : 'holding';
  return { status, kind: playback.kind, clipId: playback.clipId, title: titles[playback.clipId], position, duration, progress: position / duration * 100 };
}
