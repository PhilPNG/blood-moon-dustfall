import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic2, SkipForward } from 'lucide-react';
import type { RoomView } from '../../shared/types';
import { CinematicHistory, type CaptionLanguage } from '../../shared/cinematics';
import { narrationEvent, narrationFallback, narrationPlayback, parseNarrationManifest, type NarrationClip, type NarrationId } from '../../shared/narration';
import { useNativePlayback, type PlaybackReporter } from './media-playback';
import { playbackEventKey } from '../../shared/media-sync';
import { useCountdown } from '../useCountdown';
import { useMediaManifest } from './media-manifest';
import { narrationText } from './media-fallback';
import { attentionEventKey } from '../../shared/attention';
import { useAttentionCountdown } from '../useAttentionCountdown';
import { attentionPermitReleased, groupedNarrationCue, type AttentionPermit, type AttentionRequester } from './media-attention';
import { stageAudioEnabled } from './stage-audio';

interface NarrationRequest { key: string; phaseKey: string; clipId: NarrationId }
export function narrationPresentationBusy(state: { mediaLeader: boolean; active: boolean; requesting: boolean; sound: boolean; phaseConsumed: boolean }): boolean {
  return state.mediaLeader && (state.active || state.requesting || (state.sound && !state.phaseConsumed));
}
interface HostNarratorProps { room: RoomView; connected: boolean; sound: boolean; mediaLeader?: boolean; language: CaptionLanguage; blocked: boolean; incidentalBlocked?: boolean; evidenceReady: boolean; onPlayback?: PlaybackReporter; onAttention?: AttentionRequester; onBusyChange?: (busy: boolean) => void }
function historyForTab() {
  try { return new CinematicHistory(window.sessionStorage, 'dustfall.narration.viewed.v1'); } catch { return new CinematicHistory(undefined, 'dustfall.narration.viewed.v1'); }
}

/** One host voice at a time, always behind the native film soundtrack. */
export function HostNarrator({ room, connected, sound: preferredSound, mediaLeader = true, language, blocked, incidentalBlocked = false, evidenceReady, onPlayback, onAttention, onBusyChange }: HostNarratorProps) {
  const sound = stageAudioEnabled(preferredSound, mediaLeader);
  const event = narrationEvent(room), phaseKey = event.key;
  const attentionContext = attentionEventKey(room);
  const latestAttentionContext = useRef(attentionContext); latestAttentionContext.current = attentionContext;
  const attentionSeconds = useAttentionCountdown(room);
  const [history] = useState(historyForTab);
  const { manifest, exhausted: manifestUnavailable } = useMediaManifest('/media/narration.json', parseNarrationManifest, connected);
  const [request, setRequest] = useState<NarrationRequest | null>(null);
  const [permit, setPermit] = useState<AttentionPermit | null>(null);
  const [requesting, setRequesting] = useState(false);
  const claimRequest = useRef<string | null>(null), retryAfter = useRef(0);
  const remaining = useCountdown(room.timer, room.serverNow);
  const { active, suspended } = narrationPlayback(request, phaseKey, { connected, sound, paused: room.timer.isPaused, cinematicBlocked: blocked });
  const phaseConsumed = history.has(`${phaseKey}:narration:${event.clipId}`);
  const busy = narrationPresentationBusy({ mediaLeader, active: !!active, requesting, sound, phaseConsumed });
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => { setPermit(null); setRequesting(false); claimRequest.current = null; retryAfter.current = 0; }, [attentionContext]);
  useEffect(() => {
    if (request && request.phaseKey !== phaseKey) setRequest(null);
  }, [phaseKey, request]);
  useEffect(() => {
    if ((!manifest && !manifestUnavailable) || active || suspended || requesting) return;
    const candidate = groupedNarrationCue(room, {
      sound, blocked, remaining, evidenceReady,
      phaseConsumed,
      timerConsumed: history.has(`${phaseKey}:narration:timer-warning`),
      evidenceConsumed: history.has(`${phaseKey}:narration:evidence`),
    });
    if (!candidate) return;
    if (incidentalBlocked && (candidate.clipId === 'timer-warning' || candidate.clipId === 'evidence')) return;
    const incidental = candidate.clipId === 'lobby' ? 'lobby' : candidate.clipId === 'timer-warning' ? 'timer-warning' : undefined;
    if (onAttention && incidental && !attentionPermitReleased(room, permit, candidate.key, attentionSeconds)) {
      if (!connected || claimRequest.current || performance.now() < retryAfter.current) return;
      const context = attentionContext;
      claimRequest.current = context; retryAfter.current = performance.now() + 1_000; setRequesting(true);
      void onAttention(incidental).then(receipt => {
        if (receipt && latestAttentionContext.current === context) setPermit({ key: candidate.key, eventKey: context, id: receipt.attention.id });
      }).catch(() => { /* Busy or unavailable displays retry on a later room sample. */ }).finally(() => {
        if (claimRequest.current === context) { claimRequest.current = null; setRequesting(false); }
      });
      return;
    }
    if (history.claim(candidate.key)) setRequest({ ...candidate, phaseKey });
  }, [phaseKey, attentionContext, attentionSeconds, room.serverNow, permit, requesting, connected, onAttention, phaseConsumed, active, suspended, blocked, incidentalBlocked, remaining, evidenceReady, manifest, manifestUnavailable, sound, history]);
  const finish = useCallback(() => setRequest(null), []);
  if (!active) return null;
  const clip = manifest?.clips.find(item => item.id === active.clipId);
  return <NarrationAudio key={active.key} eventKey={playbackEventKey(room, active.key)} clip={clip} fallback={narrationFallback(room, active.clipId)} language={language} suspended={suspended} onFinish={finish} onPlayback={onPlayback}/>;
}

interface NarrationAudioProps { eventKey: string; clip?: NarrationClip; fallback: string; language: CaptionLanguage; suspended: boolean; onFinish: () => void; onPlayback?: PlaybackReporter }
export function NarrationAudio({ eventKey, clip, fallback, language, suspended, onFinish, onPlayback }: NarrationAudioProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0), [started, setStarted] = useState(false), [textMode, setTextMode] = useState(!clip);
  useNativePlayback(audio, { eventKey, clipId: clip?.id || '', kind: 'narration' }, clip ? onPlayback : undefined, !suspended && !textMode);
  const caption = narrationText(clip, fallback, language, time, textMode);
  const duration = clip?.duration ?? 11;
  useEffect(() => {
    const element = audio.current;
    if (!element || textMode) return;
    if (suspended) { element.pause(); return; }
    let disposed = false;
    void element.play().catch(() => { if (!disposed) { element.pause(); setTextMode(true); } });
    return () => { disposed = true; element.pause(); };
  }, [clip?.src, suspended, textMode]);
  useEffect(() => {
    if (started || textMode || suspended) return;
    const timeout = window.setTimeout(() => setTextMode(true), 3500);
    return () => window.clearTimeout(timeout);
  }, [started, textMode, suspended]);
  useEffect(() => {
    if (!textMode || suspended) return;
    audio.current?.pause();
    const interval = window.setInterval(() => setTime(current => current + .25), 250);
    return () => window.clearInterval(interval);
  }, [textMode, suspended]);
  useEffect(() => {
    if (suspended) return;
    if (time >= duration) { onFinish(); return; }
    const timeout = window.setTimeout(() => { setTextMode(true); }, 6000);
    return () => window.clearTimeout(timeout);
  }, [time, duration, suspended, onFinish]);
  return <>
    {clip && <audio ref={audio} src={clip.src} preload="auto" muted={suspended || textMode} onPlaying={() => setStarted(true)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onEnded={onFinish} onError={() => { audio.current?.pause(); setTextMode(true); }} aria-label={clip.title}/>}
    {!suspended && <>
      <div className="narrator-speaking" role="status"><Mic2 aria-hidden="true"/><span>{textMode ? 'A note from your host' : 'Dustfall’s host'}</span><button onClick={onFinish} aria-label="Skip narration"><SkipForward aria-hidden="true"/> Skip voice</button></div>
      {caption.text && <div className={`narrator-caption${caption.transcript ? ' narrator-text-note' : ''}`} lang={caption.language}>{caption.text}</div>}
    </>}
  </>;
}
