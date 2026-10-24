import { useEffect, useRef, useState } from 'react';
import type { Action, RoomView } from '../../shared/types';

export type PartyActionProps = { room: RoomView; connected: boolean; disabled?: boolean; onAction: (action: Action) => Promise<void> };

export function usePartyAction(onAction?: (action: Action) => Promise<void>) {
  const pending = useRef(false), mounted = useRef(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(action: Action): Promise<boolean> {
    if (!onAction || pending.current) return false;
    pending.current = true; setBusy(true); setError('');
    try { await onAction(action); return true; }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not save. Try again.'); return false; }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return { run, busy, error };
}

/** Store only a few local booleans, never character information or credentials. */
export function useLocalPartyFlags<K extends string>(key: string, names: readonly K[]) {
  const [flags, setFlags] = useState<Record<K, boolean>>(() => {
    let saved: unknown;
    try { saved = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* Optional preference storage. */ }
    return Object.fromEntries(names.map(name => [name, !!saved && typeof saved === 'object' && (saved as Record<string, unknown>)[name] === true])) as Record<K, boolean>;
  });
  function update(name: K, value: boolean) {
    const next = { ...flags, [name]: value };
    setFlags(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep this visit usable when storage is blocked. */ }
  }
  return [flags, update] as const;
}
