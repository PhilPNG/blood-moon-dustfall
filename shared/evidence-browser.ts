import type { RoomView } from './types.js';

export type EvidenceFilter = 'all' | 'case' | 'shared' | 'pinned';

export interface PublicEvidenceItem {
  key: string;
  title: string;
  text: string;
  kind: 'case' | 'shared';
  playerName?: string;
  round?: number;
}

export function publicEvidence(room: Pick<RoomView, 'act' | 'clues'>): PublicEvidenceItem[] {
  return [
    ...(room.act?.evidence ?? []).map(item => ({
      key: `case:${item.id}`, title: item.title, text: item.text, kind: 'case' as const,
    })),
    ...room.clues.filter(clue => clue.published === true).map(clue => ({
      key: `shared:${clue.id}`, title: clue.title, text: clue.text, kind: 'shared' as const,
      playerName: clue.playerName, round: clue.round,
    })),
  ];
}

function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function filterPublicEvidence(items: readonly PublicEvidenceItem[], filter: EvidenceFilter, query: string, pins: ReadonlySet<string>): PublicEvidenceItem[] {
  const words = searchable(query).split(/\s+/).filter(Boolean);
  return items.filter(item => {
    if (filter === 'pinned' ? !pins.has(item.key) : filter !== 'all' && item.kind !== filter) return false;
    const text = searchable(`${item.title}\n${item.text}\n${item.playerName ?? ''}`);
    return words.every(word => text.includes(word));
  });
}

export function evidenceStorageKey(room: Pick<RoomView, 'code' | 'gameId' | 'me'>): string {
  return `dustfall:evidence-pins:v1:${JSON.stringify([room.code, room.gameId ?? 'legacy', room.me?.playerId ?? 'public'])}`;
}

function boundedPins(values: Iterable<unknown>): Set<string> {
  const pins = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || value.length > 200) continue;
    const separator = value.indexOf(':');
    const source = value.slice(0, separator), id = value.slice(separator + 1);
    if ((source !== 'case' && source !== 'shared') || !id || /[^A-Za-z0-9._-]/.test(id)) continue;
    pins.add(value);
    if (pins.size === 200) break;
  }
  return pins;
}

export function readEvidencePins(storage: Pick<Storage, 'getItem'> | undefined, key: string): Set<string> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
    return Array.isArray(value) ? boundedPins(value) : new Set();
  } catch {
    return new Set();
  }
}

export function writeEvidencePins(storage: Pick<Storage, 'setItem'> | undefined, key: string, pins: ReadonlySet<string>): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify([...boundedPins(pins)]));
    return true;
  } catch {
    return false;
  }
}
