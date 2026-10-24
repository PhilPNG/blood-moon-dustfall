import type { CaptionLanguage, RoomView } from './types';
import { publicEvidence, type PublicEvidenceItem } from './evidence-browser';

export function preflightEvent(room: RoomView): { key: string; clipId: 'clue' } | null {
  if (room.phase !== 'lobby' || !room.preflight || !Number.isSafeInteger(room.preflight.serial) || room.preflight.serial <= 0) return null;
  return { key: `${room.gameId ?? `legacy-${room.code}`}:lobby:0:preflight:${room.actionEpoch ?? 0}:${room.preflight.serial}`, clipId: 'clue' };
}
export function preflightCaptionLanguage(room: RoomView, language: CaptionLanguage): CaptionLanguage { return preflightEvent(room) && language === 'off' ? 'en' : language; }
export function spotlightEvidence(room: RoomView, blocked = false): PublicEvidenceItem | null {
  if (blocked || !room.spotlight) return null;
  return publicEvidence(room).find(item => item.key === room.spotlight!.evidenceId) ?? null;
}
export function evidencePage(items: readonly PublicEvidenceItem[], page: number, size = 3): PublicEvidenceItem[] {
  const count = Math.max(1, Math.floor(Number.isFinite(size) ? size : 3));
  const pages = Math.max(1, Math.ceil(items.length / count));
  const index = ((Math.floor(Number.isFinite(page) ? page : 0) % pages) + pages) % pages;
  return items.slice(index * count, index * count + count);
}
