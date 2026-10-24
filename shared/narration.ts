import type { RoomView } from './types';
import { cinematicEvent, type CaptionCue } from './cinematics';

export const NARRATION_IDS = ['lobby', 'roles', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5', 'voting', 'caught', 'escaped-wrong', 'escaped-tie', 'timer-warning', 'evidence'] as const;
export type NarrationId = typeof NARRATION_IDS[number];
export interface NarrationClip { id: NarrationId; title: string; src: string; duration: number; captions?: { en?: string; es?: string; ptBR?: string }; cues: { en: CaptionCue[]; es?: CaptionCue[]; ptBR: CaptionCue[] } }
export interface NarrationManifest { version: 1; clips: NarrationClip[] }
export interface NarrationEvent { key: string; clipId: NarrationId }
export function narrationEvent(room: RoomView): NarrationEvent {
  const film = cinematicEvent(room);
  const key = film?.key ?? `${room.gameId ?? `legacy-${room.code}`}:lobby:0`;
  return { key, clipId: room.phase === 'roles' ? 'roles' : film?.clipId as NarrationId ?? 'lobby' };
}
/** Preserve the same mounted audio request through interruptions; a new story phase retires it. */
export function narrationPlayback<T extends { phaseKey: string }>(request: T | null, phaseKey: string, options: { connected: boolean; sound: boolean; paused: boolean; cinematicBlocked: boolean }): { active: T | null; suspended: boolean } {
  return { active: request?.phaseKey === phaseKey ? request : null, suspended: !options.connected || !options.sound || options.paused || options.cinematicBlocked };
}
export interface NarrationCueOptions { sound: boolean; blocked: boolean; phaseConsumed: boolean; timerConsumed: boolean; evidenceConsumed: boolean; evidenceReady: boolean; remaining: number }
export function narrationCue(room: RoomView, options: NarrationCueOptions): NarrationEvent | null {
  if (!options.sound || options.blocked || room.timer.isPaused || room.masterReady === false) return null;
  const event = narrationEvent(room);
  if (room.phase === 'investigation' && options.remaining <= 30 && options.remaining > 0 && !options.timerConsumed) return { key: `${event.key}:narration:timer-warning`, clipId: 'timer-warning' };
  if (!options.phaseConsumed) return { key: `${event.key}:narration:${event.clipId}`, clipId: event.clipId };
  if (room.phase === 'investigation' && options.evidenceReady && !options.evidenceConsumed) return { key: `${event.key}:narration:evidence`, clipId: 'evidence' };
  return null;
}
export function narrationFallback(room: RoomView, id: NarrationId): string {
  if (id === 'lobby') return 'Welcome to Dustfall. Join on your phone. The game master will deal your secret identities when everyone is here.';
  if (id === 'roles') return 'Read your private profile, secrets and missions on your phone. Keep your confession private, then tap I’m ready.';
  if (id.startsWith('act-')) return room.act?.narration || 'Search a location, share your clue, answer the case question and compare the evidence together.';
  if (id === 'voting') return 'Compare the public seal colors and symbols. Make one final accusation on your phone. Your vote stays sealed until the truth is revealed.';
  if (id === 'timer-warning') return 'Thirty seconds remain in this act. Compare your evidence and finish your search and case answer on your phone.';
  if (id === 'evidence') return 'A new clue is public. Compare it with the case evidence and the other suspects’ accounts.';
  return room.result?.caught ? 'The town found its culprit. Review the full case and your party’s awards.' : 'The culprit escaped the final accusation. Review the full case to see how the evidence fits together.';
}
export function parseNarrationManifest(value: unknown): NarrationManifest {
  const manifest: NarrationManifest = { version: 1, clips: [] };
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object';
  if (!record(value) || value.version !== 1 || !Array.isArray(value.clips)) return manifest;
  for (const raw of value.clips) {
    if (!record(raw) || !NARRATION_IDS.includes(raw.id as NarrationId) || typeof raw.src !== 'string' || !(/^\/media\/narrator\/[a-z0-9.-]+\.(mp3|m4a|wav|ogg)$/i.test(raw.src) || /^https:\/\//i.test(raw.src)) || typeof raw.title !== 'string' || typeof raw.duration !== 'number' || !Number.isFinite(raw.duration) || raw.duration <= 0 || raw.duration > 240 || manifest.clips.some(clip => clip.id === raw.id)) continue;
    const cues = record(raw.cues) ? raw.cues : {};
    const list = (items: unknown): CaptionCue[] => Array.isArray(items) ? items.filter((cue): cue is CaptionCue => record(cue) && typeof cue.start === 'number' && Number.isFinite(cue.start) && typeof cue.end === 'number' && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start && cue.end <= (raw.duration as number) + .5 && typeof cue.text === 'string').sort((a, b) => a.start - b.start) : [];
    const captions = record(raw.captions) ? raw.captions : {};
    const caption = (value: unknown) => typeof value === 'string' && /^\/media\/narrator\/[a-z0-9.-]+\.vtt$/i.test(value) ? value : undefined;
    manifest.clips.push({ id: raw.id as NarrationId, title: raw.title, src: raw.src, duration: raw.duration, captions: { en: caption(captions.en), es: caption(captions.es), ptBR: caption(captions.ptBR) }, cues: { en: list(cues.en), es: list(cues.es), ptBR: list(cues.ptBR) } });
  }
  return manifest;
}
