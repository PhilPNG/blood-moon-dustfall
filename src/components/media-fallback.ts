import { captionAt, type CaptionLanguage } from '../../shared/cinematics';
import type { NarrationClip } from '../../shared/narration';
import { translate } from '../i18n';

export function autoplayNeedsGesture(cause: unknown): boolean {
  return !!cause && typeof cause === 'object' && 'name' in cause && cause.name === 'NotAllowedError';
}

/** Only foreground playback can stall: background suspension and permission prompts wait for the audience. */
export function watchFilmProgress(options: { started: boolean; paused: boolean; needsGesture: boolean }, onTimeout: () => void): () => void {
  if (options.paused || options.needsGesture) return () => {};
  const page = typeof document === 'undefined' ? undefined : document;
  const lifecycle = typeof window === 'undefined' ? undefined : window;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pageActive = true;
  const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const watch = () => {
    cancel();
    if (!pageActive || page?.hidden) return;
    timer = setTimeout(() => {
      timer = undefined;
      // Check again in case a frozen tab resumes before its visibility event is delivered.
      if (pageActive && !page?.hidden) onTimeout();
    }, options.started ? 6_000 : 4_500);
  };
  const hide = () => { pageActive = false; cancel(); };
  const show = () => { pageActive = true; watch(); };
  page?.addEventListener('visibilitychange', watch);
  lifecycle?.addEventListener('pagehide', hide);
  lifecycle?.addEventListener('pageshow', show);
  watch();
  return () => {
    cancel();
    page?.removeEventListener('visibilitychange', watch);
    lifecycle?.removeEventListener('pagehide', hide);
    lifecycle?.removeEventListener('pageshow', show);
  };
}

/** Audio fallback is a readable transcript, independent of missing audio cue progress. */
export function narrationText(clip: NarrationClip | undefined, fallback: string, language: CaptionLanguage, time: number, textMode: boolean): { text: string; language: Exclude<CaptionLanguage, 'off'>; transcript: boolean } {
  const selected = language === 'off' ? 'en' : language;
  const cues = selected === 'pt-BR' ? clip?.cues.ptBR : selected === 'es' ? clip?.cues.es : clip?.cues.en;
  if (!textMode) return { text: language === 'off' ? '' : captionAt(cues ?? [], time), language: selected, transcript: false };
  const authored = cues?.map(cue => cue.text).join(' ');
  const localized = translate(selected, fallback);
  const guidance = selected === 'en' || localized !== fallback ? localized : translate(selected, 'Follow the evidence.');
  return { text: authored || guidance, language: selected, transcript: true };
}
