export function displayLease(onChange: (active: boolean) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let revokedAt = -Infinity;
  const change = (next: boolean) => { if (active !== next) { active = next; onChange(next); } };
  const revoke = () => { revokedAt = performance.now(); if (timer) clearTimeout(timer); timer = undefined; change(false); };
  return {
    renew(startedAt: number) {
      const remaining = startedAt + 7_500 - performance.now();
      if (startedAt <= revokedAt || !Number.isFinite(remaining) || remaining <= 0) { change(false); return; }
      if (timer) clearTimeout(timer);
      change(true); timer = setTimeout(() => { timer = undefined; change(false); }, remaining);
    }, revoke,
  };
}
