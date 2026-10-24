/** Close just this tab's lease; the durable player seat/controller is retained. */
export function closePresence(presence: { code: string; token: string; clientId: string }): void {
  const body = JSON.stringify({ event: 'room:unsubscribe', payload: presence, requestId: crypto.randomUUID() });
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon?.('/api/rpc', new Blob([body], { type: 'application/json' }))) return;
  } catch { /* Fall back when the browser declines beacon delivery. */ }
  try { void fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {}); }
  catch { /* A disconnected browser will expire its lease automatically. */ }
}
