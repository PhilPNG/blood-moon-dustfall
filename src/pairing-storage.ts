import type { PairingTicket } from '../shared/types';

type PairingMemory = { tickets: Map<string, PairingTicket>; pending: Set<string>; cleared: Set<string> };
const memories = new WeakMap<object, PairingMemory>();
const keyFor = (code: string) => `alibi:pairing:${code}`;

function context(): { storage?: Storage; memory: PairingMemory } {
  let storage: Storage | undefined;
  try { storage = globalThis.sessionStorage; } catch { /* The tab still retains its original pairing capability. */ }
  const owner = typeof window !== 'undefined' ? window : storage ?? globalThis;
  let memory = memories.get(owner);
  if (!memory) {
    memory = { tickets: new Map(), pending: new Set(), cleared: new Set() };
    memories.set(owner, memory);
  }
  return { storage, memory };
}

function ticket(value: unknown, code?: string): PairingTicket | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const data = value as Record<string, unknown>;
  if (typeof data.code !== 'string' || !/^[A-Z]{4}$/.test(data.code) || (code !== undefined && data.code !== code) ||
    typeof data.ticket !== 'string' || !data.ticket || typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt)) return;
  return { code: data.code, ticket: data.ticket, expiresAt: data.expiresAt };
}

export function savePairing(pairing: PairingTicket): boolean {
  const safe = ticket(pairing);
  if (!safe) return false;
  const { storage, memory } = context();
  memory.tickets.set(safe.code, safe);
  memory.pending.add(safe.code);
  memory.cleared.delete(safe.code);
  try {
    if (storage) {
      storage.setItem(keyFor(safe.code), JSON.stringify(safe));
      memory.pending.delete(safe.code);
      return true;
    }
  } catch { /* Preparing another room would lose the original successful creation. */ }
  return false;
}

export function getPairing(code: string): PairingTicket | undefined {
  const { storage, memory } = context();
  if (memory.cleared.has(code)) return;
  if (!storage || memory.pending.has(code)) return ticket(memory.tickets.get(code), code);
  try {
    const saved = ticket(JSON.parse(storage.getItem(keyFor(code)) || 'null'), code);
    if (saved) { memory.tickets.set(code, saved); return { ...saved }; }
    memory.tickets.delete(code);
  } catch { return ticket(memory.tickets.get(code), code); }
}

export function clearPairing(code: string): void {
  const { storage, memory } = context();
  memory.tickets.delete(code);
  memory.pending.delete(code);
  memory.cleared.add(code);
  try { storage?.removeItem(keyFor(code)); } catch { /* A stale ticket cannot reappear during this visit. */ }
}
