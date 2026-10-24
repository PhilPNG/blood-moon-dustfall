export interface ArcadeAudioContext extends EventTarget {
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** TV-local audio preference; native audio is created only by the Sound gesture. */
export function createArcadeSound<Context extends ArcadeAudioContext>(create: () => Context, changed: () => void) {
  let context: Context | null = null, enabled = false, pending = false, revision = 0;
  const stateChanged = () => changed();
  const mute = () => { enabled = false; changed(); };
  return {
    snapshot: () => ({ context, enabled, needsResume: enabled && context?.state !== 'running', pending }),
    async toggle() {
      if (pending) return false;
      if (enabled && context?.state === 'running') { mute(); return false; }
      enabled = true; pending = true;
      const attempt = ++revision;
      try {
        if (!context || context.state === 'closed') {
          context?.removeEventListener('statechange', stateChanged);
          context = create();
          context.addEventListener('statechange', stateChanged);
        }
        changed();
        await context.resume();
        return attempt === revision && enabled && context?.state === 'running';
      } catch { return false; }
      finally { if (attempt === revision) { pending = false; changed(); } }
    },
    mute,
    close() {
      revision++;
      const old = context;
      old?.removeEventListener('statechange', stateChanged);
      context = null; enabled = false; pending = false;
      if (old && old.state !== 'closed') void old.close().catch(() => {});
    },
  };
}
