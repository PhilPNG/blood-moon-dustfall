import { captionAt, type CaptionLanguage } from '../../shared/cinematics';
import type { NarrationClip } from '../../shared/narration';
import { translate } from '../i18n';

export function autoplayNeedsGesture(cause: unknown): boolean {
  return !!cause && typeof cause === 'object' && 'name' in cause && cause.name === 'NotAllowedError';
}

/** A browser permission prompt waits for the audience; a broken source stays bounded. */
export function watchFilmProgress(options: { started: boolean; paused: boolean; needsGesture: boolean }, onTimeout: () => void): () => void {
  if (options.paused || options.needsGesture) return () => {};
  const timer = setTimeout(onTimeout, options.started ? 6_000 : 4_500);
  return () => clearTimeout(timer);
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
