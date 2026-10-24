import type { RoomView, Session, SessionKind } from '../shared/types';

type SavedGame = { kind: SessionKind; session: Session };
type RecentGame = { kind: SessionKind; code: string; updatedAt: number };
type SessionMemory = {
  sessions: Map<string, Session>;
  pending: Map<string, string | undefined>;
  forgotten: Map<string, string | undefined>;
  recent: Map<string, number>;
  removedRecent: Set<string>;
};

const RECENT_KEY = 'alibi:saved-games';
const memories = new WeakMap<object, SessionMemory>();
const keyFor = (kind: SessionKind, code: string) => `alibi:${kind}:${code}`;

function context(): { storage?: Storage; memory: SessionMemory } {
  let storage: Storage | undefined;
  try { storage = globalThis.localStorage; } catch { /* Private browsing can deny even the getter. */ }
  const owner = typeof window !== 'undefined' ? window : storage ?? globalThis;
  let memory = memories.get(owner);
  if (!memory) {
    memory = { sessions: new Map(), pending: new Map(), forgotten: new Map(), recent: new Map(), removedRecent: new Set() };
    memories.set(owner, memory);
  }
  return { storage, memory };
}

/** Keep credentials and public labels only, even when handed an entire response. */
function summary(value: unknown, code?: string): Session | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const data = value as Record<string, unknown>;
  if (typeof data.code !== 'string' || !/^[A-Z]{4}$/.test(data.code) || (code !== undefined && data.code !== code) || typeof data.token !== 'string' || !data.token) return;
  const result: Session = { code: data.code, token: data.token };
  for (const field of ['playerId', 'recoveryCode', 'name', 'characterName'] as const) {
    if (typeof data[field] === 'string' && data[field]) result[field] = data[field];
  }
  for (const field of ['expiresAt', 'updatedAt', 'recoveryRevision'] as const) {
    if (typeof data[field] === 'number' && Number.isFinite(data[field]) && data[field] >= 0) result[field] = data[field];
  }
  return result;
}

/** Revisions span bearer rotations, but restart for a new room lifetime/seat. */
function retiredCredential(incoming: Session, known: Session | undefined): boolean {
  return !!known && incoming.token !== known.token && incoming.code === known.code &&
    incoming.playerId === known.playerId && known.expiresAt !== undefined && incoming.expiresAt === known.expiresAt &&
    known.recoveryRevision !== undefined && (incoming.recoveryRevision ?? -1) <= known.recoveryRevision;
}

function notifySessionsChanged() {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event('alibi:sessions-changed')); }
  catch { /* A saved session must remain usable if notification is unavailable. */ }
}

function recentGames(storage?: Storage): RecentGame[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(RECENT_KEY) || '[]');
    return Array.isArray(value) ? value.filter((entry): entry is RecentGame => !!entry && typeof entry === 'object' &&
      ['master', 'player'].includes(entry.kind) && typeof entry.code === 'string' && /^[A-Z]{4}$/.test(entry.code) &&
      typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)) : [];
  } catch { return []; }
}

function persistRecent(storage: Storage | undefined, memory: SessionMemory) {
  if (!storage) return;
  const recent = new Map(recentGames(storage).map(entry => [keyFor(entry.kind, entry.code), entry.updatedAt]));
  for (const [key, updatedAt] of memory.recent) recent.set(key, updatedAt);
  for (const key of memory.removedRecent) recent.delete(key);
  const entries = [...recent].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, updatedAt]) => {
    const [, kind, code] = key.split(':');
    return { kind, code, updatedAt };
  });
  try { storage.setItem(RECENT_KEY, JSON.stringify(entries)); } catch { /* Legacy room keys still permit discovery. */ }
}

export function saveSession(kind: SessionKind, session: Session): boolean {
  let safe = summary(session);
  if (!safe) return false;
  const current = getSession(kind, safe.code);
  if (retiredCredential(safe, current)) safe = current!;
  if (current?.token === safe.token && current.recoveryRevision !== undefined && (safe.recoveryRevision ?? -1) <= current.recoveryRevision) {
    safe.recoveryRevision = current.recoveryRevision;
    if (current.recoveryCode) safe.recoveryCode = current.recoveryCode;
  }
  const { storage, memory } = context();
  const key = keyFor(kind, safe.code);
  let previousToken = memory.pending.get(key) ?? memory.sessions.get(key)?.token;
  if (!memory.pending.has(key)) {
    try { previousToken = summary(JSON.parse(storage?.getItem(key) || 'null'), safe.code)?.token; } catch { /* Keep the last observed token as the disk baseline. */ }
  }
  memory.sessions.set(key, safe);
  memory.pending.set(key, previousToken);
  memory.forgotten.delete(key);
  memory.removedRecent.delete(key);
  memory.recent.set(key, safe.updatedAt ?? Date.now());
  let persisted = false;
  try {
    if (storage) {
      storage.setItem(key, JSON.stringify(safe));
      memory.pending.delete(key);
      persisted = true;
    }
  } catch { /* The in-memory session still owns the same server seat. */ }
  if (kind === 'master') {
    try { storage?.setItem('alibi:last-master', safe.code); } catch { /* This convenience pointer is optional. */ }
  }
  persistRecent(storage, memory);
  notifySessionsChanged();
  return persisted;
}

export function getSession(kind: SessionKind, code: string): Session | undefined {
  const { storage, memory } = context();
  const key = keyFor(kind, code);
  try {
    if (!storage) return summary(memory.sessions.get(key), code);
    const value = summary(JSON.parse(storage.getItem(key) || 'null'), code);
    const cached = summary(memory.sessions.get(key), code);
    if (value && retiredCredential(value, cached)) return cached;
    if (memory.pending.has(key)) {
      // Ignore the old value that a failed write could not replace, while
      // allowing another tab's subsequent credential rotation to take effect.
      const newerCode = value?.token === cached?.token && (value?.recoveryRevision ?? 0) > (cached?.recoveryRevision ?? 0);
      if (!newerCode && (!value || value.token === cached?.token || value.token === memory.pending.get(key))) return cached;
      memory.pending.delete(key);
    }
    if (value && cached?.token === value.token && (cached.recoveryRevision ?? 0) > (value.recoveryRevision ?? 0)) {
      value.recoveryRevision = cached.recoveryRevision;
      if (cached.recoveryCode) value.recoveryCode = cached.recoveryCode;
    }
    if (memory.forgotten.has(key)) {
      if (!value || memory.forgotten.get(key) === undefined || value.token === memory.forgotten.get(key)) return;
      memory.forgotten.delete(key);
    }
    if (value) {
      memory.sessions.set(key, value);
      memory.removedRecent.delete(key);
      return { ...value };
    }
    memory.sessions.delete(key);
  } catch { return summary(memory.sessions.get(key), code); }
}

export function forgetSession(kind: SessionKind, code: string): void {
  const current = getSession(kind, code);
  const { storage, memory } = context();
  const key = keyFor(kind, code);
  memory.sessions.delete(key);
  memory.pending.delete(key);
  memory.forgotten.set(key, current?.token);
  memory.recent.delete(key);
  memory.removedRecent.add(key);
  try { if (storage) { storage.removeItem(key); memory.forgotten.delete(key); } } catch { /* Suppress the stale stored token for this visit. */ }
  if (kind === 'master') {
    try { if (storage?.getItem('alibi:last-master') === code) storage.removeItem('alibi:last-master'); } catch { /* Preserve other rooms even when access is denied. */ }
  }
  persistRecent(storage, memory);
  notifySessionsChanged();
}

export function savedGames(): SavedGame[] {
  const { storage, memory } = context();
  const candidates = new Set<string>(memory.sessions.keys());
  const timestamps = new Map(memory.recent);
  for (const entry of recentGames(storage)) {
    const key = keyFor(entry.kind, entry.code);
    candidates.add(key);
    if (!timestamps.has(key)) timestamps.set(key, entry.updatedAt);
  }
  try {
    for (let index = 0; storage && index < storage.length; index++) {
      const key = storage.key(index);
      if (key && /^alibi:(master|player):[A-Z]{4}$/.test(key)) candidates.add(key);
    }
    const lastMaster = storage?.getItem('alibi:last-master');
    if (lastMaster && /^[A-Z]{4}$/.test(lastMaster)) candidates.add(keyFor('master', lastMaster));
  } catch { /* Cached sessions remain discoverable when enumeration is blocked. */ }
  const games: SavedGame[] = [];
  for (const key of candidates) {
    const [, kind, code] = key.split(':');
    if (kind !== 'master' && kind !== 'player') continue;
    const session = getSession(kind, code);
    if (session) games.push({ kind, session });
  }
  const updatedAt = (game: SavedGame) => game.session.updatedAt ?? timestamps.get(keyFor(game.kind, game.session.code)) ?? 0;
  return games.sort((a, b) => updatedAt(b) - updatedAt(a)).slice(0, 8);
}

export function updateSessionFromView(kind: SessionKind, session: Session, view: RoomView): void {
  if (view.code !== session.code) return;
  const current = getSession(kind, session.code);
  if (!current || current.token !== session.token) return;
  const next = { ...current };
  if (kind === 'master') {
    if (view.gameMaster) next.name = view.gameMaster.name;
  } else {
    const player = view.players.find(player => player.id === current.playerId);
    if (player) {
      next.name = player.name;
      if (player.roleName) next.characterName = player.roleName;
      else delete next.characterName;
    }
  }
  if (view.expiresAt !== undefined) next.expiresAt = view.expiresAt;
  if (next.name === current.name && next.characterName === current.characterName && next.expiresAt === current.expiresAt) return;
  next.updatedAt = Date.now();
  saveSession(kind, next);
}
