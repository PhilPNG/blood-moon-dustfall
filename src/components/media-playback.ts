import { useEffect, type RefObject } from 'react';
import type { MediaPlaybackReport } from '../../shared/types';

export type PlaybackReporter = (sample: MediaPlaybackReport) => void;
type PlaybackIdentity = { eventKey: string; clipId: string; kind: MediaPlaybackReport['kind'] };

/** Observe the native event stream used by the hook, independently of React render timing. */
export function observeNativePlayback(element: HTMLMediaElement, identity: PlaybackIdentity, onPlayback: PlaybackReporter, enabled = true) {
  let waiting = element.readyState < 3 || element.paused;
  let lastSent = 0;
  let lastPosition = element.currentTime;
  const emit = (force = false, stopped = false) => {
    const now = performance.now();
    if (!force && now - lastSent < 950) return;
    lastSent = now;
    lastPosition = element.currentTime;
    onPlayback({ ...identity, position: Number.isFinite(element.currentTime) ? element.currentTime : 0, playing: enabled && !stopped && !waiting && !element.paused && !element.ended && !(typeof document !== 'undefined' && document.hidden) });
  };
  const playing = () => { waiting = false; emit(true); };
  const awaitingData = () => { waiting = true; emit(true); };
  // A stalled network request can leave enough buffered data for uninterrupted playback.
  const stalled = () => { if (element.readyState < 3) waiting = true; emit(true); };
  const stopped = () => emit(true, true);
  const updated = () => {
    if (!element.seeking && element.readyState >= 3 && element.currentTime > lastPosition + .01) waiting = false;
    emit();
  };
  element.addEventListener('playing', playing);
  element.addEventListener('waiting', awaitingData);
  element.addEventListener('stalled', stalled);
  element.addEventListener('pause', stopped);
  element.addEventListener('ended', stopped);
  element.addEventListener('seeking', awaitingData);
  element.addEventListener('timeupdate', updated);
  const interval = setInterval(updated, 1000);
  emit(true);
  return () => {
    clearInterval(interval);
    element.removeEventListener('playing', playing);
    element.removeEventListener('waiting', awaitingData);
    element.removeEventListener('stalled', stalled);
    element.removeEventListener('pause', stopped);
    element.removeEventListener('ended', stopped);
    element.removeEventListener('seeking', awaitingData);
    element.removeEventListener('timeupdate', updated);
    stopped();
  };
}

/** Observe the media element itself. No phase timer, estimated duration, or text fallback is broadcast. */
export function useNativePlayback(ref: RefObject<HTMLMediaElement | null>, identity: PlaybackIdentity, onPlayback?: PlaybackReporter, enabled = true) {
  useEffect(() => {
    const element = ref.current;
    if (!element || !onPlayback) return;
    return observeNativePlayback(element, identity, onPlayback, enabled);
  }, [ref, identity.eventKey, identity.clipId, identity.kind, onPlayback, enabled]);
}
