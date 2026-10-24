import { useCallback, useEffect, useState } from 'react';

interface Manifest { clips: unknown[] }

/** Only parsed, non-empty media can become a cached success. */
export async function loadMediaManifest<T extends Manifest>(url: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Media manifest unavailable');
  const value: unknown = await response.json();
  signal?.throwIfAborted();
  const manifest = parse(value);
  if (!manifest.clips.length) throw new Error('Media manifest unavailable');
  return manifest;
}

/** Retry an unavailable asset without repeating requests for already-loaded media. */
export function useMediaManifest<T extends Manifest>(url: string, parse: (value: unknown) => T, connected: boolean) {
  const [manifest, setManifest] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!connected || manifest) return;
    let disposed = false, attempt = 0;
    let controller: AbortController | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      attempt += 1;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 6_000);
      try {
        const loaded = await loadMediaManifest(url, parse, controller.signal);
        if (!disposed) { setManifest(loaded); setFailed(false); setExhausted(false); }
      } catch {
        if (disposed) return;
        setFailed(true);
        // A bounded retry cycle also heals a brief asset-only outage while RPC stays online.
        if (attempt < 3) retryTimer = setTimeout(() => void load(), attempt * 3_000);
        else setExhausted(true);
      } finally { clearTimeout(timeout); }
    };
    setFailed(false); setExhausted(false);
    void load();
    return () => { disposed = true; controller?.abort(); if (retryTimer) clearTimeout(retryTimer); };
  }, [url, parse, connected, retry, manifest]);
  const retryManifest = useCallback(() => { if (!manifest) { setFailed(false); setExhausted(false); setRetry(value => value + 1); } }, [manifest]);
  return { manifest, failed, exhausted, retryManifest };
}
