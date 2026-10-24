import type { RoomView } from './types';

export const CINEMATIC_IDS = ['opening', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5', 'voting', 'clue', 'caught', 'escaped-wrong', 'escaped-tie'] as const;
export type CinematicId = typeof CINEMATIC_IDS[number];
export type CaptionLanguage = 'off' | 'en' | 'es' | 'pt-BR';
export interface CaptionCue { start: number; end: number; text: string }
export interface CinematicClip {
  id: CinematicId; title: string; src: string; duration: number; poster?: string;
  captions: { en?: string; es?: string; ptBR?: string }; cues: { en: CaptionCue[]; es?: CaptionCue[]; ptBR: CaptionCue[] };
}
export interface CinematicManifest { version: 1; clips: CinematicClip[] }
export interface CinematicEvent { key: string; clipId: CinematicId }

/** Keep this selector public: it uses only information already visible on the shared screen. */
export function cinematicEvent(room: RoomView): CinematicEvent | null {
  if (room.phase === 'lobby' || room.masterReady === false) return null;
  const key = `${room.gameId ?? `legacy-${room.code}`}:${room.phase}:${room.round}`;
  if (room.phase === 'roles') return { key, clipId: 'opening' };
  if (room.phase === 'investigation') {
    const logicalAct = room.settings.rounds <= 2 && room.round === room.settings.rounds ? 3 : room.round;
    return { key, clipId: `act-${Math.max(1, Math.min(5, logicalAct))}` as CinematicId };
  }
  if (room.phase === 'voting') return { key, clipId: 'voting' };
  if (room.result?.caught) return { key, clipId: 'caught' };
  const votes = Object.values(room.result?.tallies ?? {}), maximum = Math.max(0, ...votes);
  return { key, clipId: maximum === 0 || votes.filter(count => count === maximum).length > 1 ? 'escaped-tie' : 'escaped-wrong' };
}

export function shouldAutoplayCinematic(event: CinematicEvent | null, options: { reducedMotion: boolean; viewed: boolean; presentation?: RoomView['presentation'] }): boolean {
  return !!event && !options.reducedMotion && !options.viewed && !(options.presentation?.eventKey === event.key && options.presentation.control === 'skip');
}

export function presentationCommandKey(command: RoomView['presentation']): string | undefined {
  return command ? `${command.eventKey}|${command.serial}` : undefined;
}

interface HistoryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export class CinematicHistory {
  private keys = new Set<string>();
  constructor(private storage?: HistoryStorage, private readonly storageKey = 'dustfall.cinematics.viewed.v1') {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(this.storageKey) || '[]');
      if (Array.isArray(saved)) this.keys = new Set(saved.filter((key): key is string => typeof key === 'string'));
    } catch { /* Storage can be unavailable in private browsing. */ }
  }
  has(key: string) { return this.keys.has(key); }
  claim(key: string) {
    if (this.has(key)) return false;
    this.keys.add(key);
    this.keys = new Set([...this.keys].slice(-150));
    try { this.storage?.setItem(this.storageKey, JSON.stringify([...this.keys])); } catch { /* In-memory dedupe still works. */ }
    return true;
  }
}

export interface ClueCueState { eventKey: string; seen: string[]; pending: boolean; played: boolean }
export function syncClueCue(previous: ClueCueState | undefined, eventKey: string, publishedIds: string[], introActive: boolean): { state: ClueCueState; play: boolean } {
  if (previous?.eventKey !== eventKey) return { state: { eventKey, seen: publishedIds, pending: false, played: false }, play: false };
  const pending = previous.pending || publishedIds.some(id => !previous.seen.includes(id));
  const play = pending && !previous.played && !introActive;
  return { state: { eventKey, seen: publishedIds, pending, played: previous.played || play }, play };
}
export function captionAt(cues: CaptionCue[], time: number): string {
  return cues.filter(cue => time >= cue.start && time < cue.end).map(cue => cue.text).join('\n');
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const mediaUrl = (value: unknown): value is string => typeof value === 'string' && /^https:\/\//i.test(value);
const captionUrl = (value: unknown): string | undefined => typeof value === 'string' && (/^\/media\/captions\/[a-z0-9.-]+\.vtt$/i.test(value) || mediaUrl(value)) ? value : undefined;
function cueList(value: unknown, duration: number): CaptionCue[] {
  return Array.isArray(value) ? value.filter((cue): cue is CaptionCue => record(cue) && typeof cue.start === 'number' && Number.isFinite(cue.start) && typeof cue.end === 'number' && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start && cue.end <= duration + .5 && typeof cue.text === 'string').sort((a, b) => a.start - b.start) : [];
}
export function parseCinematicManifest(value: unknown): CinematicManifest {
  const manifest: CinematicManifest = { version: 1, clips: [] };
  if (!record(value) || value.version !== 1 || !Array.isArray(value.clips)) return manifest;
  for (const raw of value.clips) {
    if (!record(raw) || !CINEMATIC_IDS.includes(raw.id as CinematicId) || !mediaUrl(raw.src) || typeof raw.title !== 'string' || typeof raw.duration !== 'number' || !Number.isFinite(raw.duration) || raw.duration <= 0 || raw.duration > 120 || manifest.clips.some(clip => clip.id === raw.id)) continue;
    const captions = record(raw.captions) ? raw.captions : {}, cues = record(raw.cues) ? raw.cues : {};
    manifest.clips.push({ id: raw.id as CinematicId, title: raw.title, src: raw.src, duration: raw.duration, poster: typeof raw.poster === 'string' && (raw.poster.startsWith('/assets/') || mediaUrl(raw.poster)) ? raw.poster : undefined, captions: { en: captionUrl(captions.en), es: captionUrl(captions.es), ptBR: captionUrl(captions.ptBR) }, cues: { en: cueList(cues.en, raw.duration), es: cueList(cues.es, raw.duration), ptBR: cueList(cues.ptBR, raw.duration) } });
  }
  return manifest;
}
