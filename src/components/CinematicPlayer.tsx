import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Captions, Film, Pause, SkipForward, Volume2 } from 'lucide-react';
import type { RoomView } from '../../shared/types';
import { captionAt, cinematicEvent, CinematicHistory, parseCinematicManifest, presentationCommandKey, shouldAutoplayCinematic, syncClueCue, type CaptionLanguage, type CinematicClip, type CinematicId, type ClueCueState } from '../../shared/cinematics';
import { CharacterPortrait, playerCharacter } from './GameArt';
import { HostNarrator } from './HostNarrator';
import { useNativePlayback, type PlaybackReporter } from './media-playback';
import { playbackEventKey } from '../../shared/media-sync';
import { useMediaManifest } from './media-manifest';
import { autoplayNeedsGesture, watchFilmProgress } from './media-fallback';
import { attentionEventKey } from '../../shared/attention';
import { useAttentionCountdown } from '../useAttentionCountdown';
import { AttentionOverlay } from './AttentionOverlay';
import { attentionClueId, attentionPermitReleased, filmHistoryKey, resumeClueAttention, skipCluePresentation, type AttentionPermit, type AttentionRequester } from './media-attention';
import { useLanguage } from '../i18n';
import { preflightCaptionLanguage, preflightEvent } from '../../shared/stage-presentation';
import { stageCopy } from './stage-translations';

const CAPTION_KEY = 'dustfall.captionLanguage';
const isCaptionLanguage = (value: unknown): value is CaptionLanguage => value === 'off' || value === 'en' || value === 'es' || value === 'pt-BR';
function storedCaptions(fallback?: CaptionLanguage): CaptionLanguage {
  try { const saved = localStorage.getItem(CAPTION_KEY); if (isCaptionLanguage(saved)) return saved; } catch { /* Storage is optional. */ }
  return fallback ?? 'off';
}
function historyForTab() {
  try { return new CinematicHistory(window.sessionStorage); } catch { return new CinematicHistory(); }
}
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}
interface PlaybackRequest { eventKey: string; clipId: CinematicId; serial: number }
interface CinematicPlayerProps {
  room: RoomView; connected: boolean; sound: boolean; toggleSound: () => void | Promise<void>;
  onPlayback?: PlaybackReporter;
  onAttention?: AttentionRequester;
  onBusyChange?: (busy: boolean) => void;
  mediaLeader?: boolean;
  embeddedControls?: boolean;
  children: (concealResults: boolean) => ReactNode;
}

/** Movies are a layer of the public stage; game phases remain authoritative on the GM phone. */
export function CinematicPlayer({ room, connected, sound, toggleSound, children, onPlayback, onAttention, onBusyChange, mediaLeader = true, embeddedControls = false }: CinematicPlayerProps) {
  const { t, language: interfaceLanguage } = useLanguage();
  const test = preflightEvent(room);
  const event = test ? mediaLeader && !room.preflight?.completed ? test : null : cinematicEvent(room), eventKey = event?.key ?? '';
  const attentionContext = attentionEventKey(room);
  const latestAttentionContext = useRef(attentionContext); latestAttentionContext.current = attentionContext;
  const attentionSeconds = useAttentionCountdown(room), attentionBlocked = attentionSeconds > 0;
  const reduced = useReducedMotion();
  const [history] = useState(historyForTab);
  const viewedKey = test ? eventKey : filmHistoryKey(room, eventKey);
  const { manifest, failed: manifestFailed, retryManifest } = useMediaManifest('/media/cinematics.json', parseCinematicManifest, connected);
  const [language, setLanguage] = useState<CaptionLanguage>(() => storedCaptions(room.captionLanguage));
  const previousRoomLanguage = useRef(room.captionLanguage);
  const previousCaptionSerial = useRef(room.captionSerial);
  const [main, setMain] = useState<PlaybackRequest | null>(null);
  const [pip, setPip] = useState<PlaybackRequest | null>(null);
  const [entered, setEntered] = useState('');
  const [notice, setNotice] = useState('');
  const [evidenceReady, setEvidenceReady] = useState('');
  const [narratorBusy, setNarratorBusy] = useState(false);
  const [cluePermit, setCluePermit] = useState<AttentionPermit | null>(null);
  const [clueRequesting, setClueRequesting] = useState(false);
  const clueRequest = useRef<string | null>(null), clueRetryAfter = useRef(0);
  const pendingClueId = useRef<string | undefined>(undefined);
  const serial = useRef(0), previousEvent = useRef<string | null>(null);
  const previousPresentation = useRef(presentationCommandKey(room.presentation));
  const clueState = useRef<ClueCueState | undefined>(undefined);
  const filmLayer = useRef<HTMLElement>(null);
  const publishedIds = room.clues.filter(clue => clue.published && clue.round === room.round).map(clue => clue.id).sort();
  const publishedKey = publishedIds.join('|');
  const mainActive = !!main && main.eventKey === eventKey;
  const autoplayAllowed = shouldAutoplayCinematic(event, { reducedMotion: test ? false : reduced, viewed: history.has(viewedKey), presentation: room.presentation });
  const awaitingEntry = entered !== eventKey && autoplayAllowed && typeof window !== 'undefined';

  const changeLanguage = useCallback((next: CaptionLanguage) => {
    setLanguage(next);
    try { localStorage.setItem(CAPTION_KEY, next); } catch { /* Keep captions usable without storage. */ }
  }, []);
  useEffect(() => {
    if (room.captionLanguage !== previousRoomLanguage.current || room.captionSerial !== previousCaptionSerial.current) {
      previousCaptionSerial.current = room.captionSerial;
      previousRoomLanguage.current = room.captionLanguage;
      if (room.captionLanguage) changeLanguage(room.captionLanguage);
    }
  }, [room.captionLanguage, room.captionSerial, changeLanguage]);
  useEffect(() => {
    if (previousEvent.current === eventKey) return;
    previousEvent.current = eventKey;
    setEntered(eventKey); setMain(null); setPip(null); setNotice(''); setEvidenceReady('');
    setCluePermit(null); setClueRequesting(false); clueRequest.current = null; clueRetryAfter.current = 0;
    pendingClueId.current = undefined;
    clueState.current = event ? syncClueCue(undefined, eventKey, publishedIds, true).state : undefined;
    if (!event || !autoplayAllowed) { if (event) history.claim(viewedKey); return; }
    setMain({ eventKey, clipId: event.clipId, serial: ++serial.current });
  }, [eventKey, reduced, history]);
  useEffect(() => {
    if (mainActive && !test && !attentionBlocked && connected && !room.timer.isPaused) history.claim(viewedKey);
  }, [mainActive, !!test, attentionBlocked, connected, room.timer.isPaused, history, viewedKey]);
  useEffect(() => {
    if (!mainActive || (!manifest && !manifestFailed) || manifest?.clips.some(clip => clip.id === main.clipId)) return;
    setMain(null); setNotice('The film is unavailable. The story continues below.');
  }, [manifest, manifestFailed, mainActive, main]);
  useEffect(() => {
    const command = room.presentation;
    const commandKey = presentationCommandKey(command);
    if (!command || previousPresentation.current === commandKey) return;
    previousPresentation.current = commandKey;
    if (!event || command.eventKey !== eventKey) return;
    setPip(null);
    if (command.control === 'skip') {
      history.claim(viewedKey); setMain(null);
      const skippedClue = skipCluePresentation(room, clueState.current, history);
      if (skippedClue) {
        clueState.current = skippedClue.state; setEvidenceReady(skippedClue.eventKey);
        pendingClueId.current = undefined; setCluePermit(null); setClueRequesting(false); clueRequest.current = null;
      }
      return;
    }
    // Replay rebases public clues; an older queued clue cannot claim against the new baseline.
    clueState.current = syncClueCue(undefined, eventKey, publishedIds, true).state;
    pendingClueId.current = undefined; setCluePermit(null); setClueRequesting(false); clueRequest.current = null;
    retryManifest(); setNotice(''); setMain({ eventKey, clipId: event.clipId, serial: ++serial.current });
  }, [room.presentation?.serial, eventKey, history, retryManifest]);
  useEffect(() => {
    const resumed = resumeClueAttention(room, clueState.current, publishedIds, history.has(`${eventKey}:clue`));
    if (!resumed) return;
    clueState.current = resumed.state;
    setCluePermit(previous => previous?.id === resumed.permit.id && previous.eventKey === resumed.permit.eventKey ? previous : resumed.permit);
  }, [room.attention?.id, room.attention?.cue, attentionContext, eventKey, history]);
  useEffect(() => {
    if (room.phase !== 'investigation' || !event || !manifest) return;
    pendingClueId.current = attentionClueId(clueState.current, publishedIds, pendingClueId.current);
    const next = syncClueCue(clueState.current, eventKey, publishedIds, mainActive || awaitingEntry || narratorBusy || attentionBlocked || clueRequesting);
    clueState.current = next.state;
    const key = `${eventKey}:clue`;
    if (!next.play || history.has(key)) return;
    if (onAttention && !attentionPermitReleased(room, cluePermit, key, attentionSeconds)) {
      // Keep this clue pending until its shared cue finishes; a failed claim consumes nothing.
      clueState.current = { ...next.state, played: false };
      if (!connected || clueRequest.current || performance.now() < clueRetryAfter.current) return;
      const context = attentionContext;
      clueRequest.current = context; clueRetryAfter.current = performance.now() + 1_000; setClueRequesting(true);
      void onAttention('clue', pendingClueId.current).then(receipt => {
        if (receipt && latestAttentionContext.current === context) setCluePermit({ key, eventKey: context, id: receipt.attention.id });
      }).catch(() => { /* Retry after the next authoritative room sample. */ }).finally(() => {
        if (clueRequest.current === context) { clueRequest.current = null; setClueRequesting(false); }
      });
      return;
    }
    if (!history.claim(key)) return;
    if (!reduced && manifest.clips.some(clip => clip.id === 'clue')) setPip({ eventKey, clipId: 'clue', serial: ++serial.current });
    else setEvidenceReady(eventKey);
  }, [publishedKey, eventKey, room.phase, room.serverNow, mainActive, awaitingEntry, narratorBusy, attentionBlocked, attentionSeconds, clueRequesting, cluePermit, attentionContext, connected, onAttention, manifest, reduced, history]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const active = mainActive ? main : null;
  const cinemaVisible = !!active || awaitingEntry || attentionBlocked;
  const activeClip = active ? manifest?.clips.find(clip => clip.id === active.clipId) : undefined;
  const pipClip = pip?.eventKey === eventKey ? manifest?.clips.find(clip => clip.id === 'clue') : undefined;
  const presentationBusy = mainActive || awaitingEntry || !!pipClip || narratorBusy || attentionBlocked;
  useEffect(() => { onBusyChange?.(presentationBusy); }, [presentationBusy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => {
    if (!cinemaVisible || embeddedControls || attentionBlocked) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    filmLayer.current?.querySelector<HTMLButtonElement>('.cinema-skip')?.focus({ preventScroll: true });
    return () => {
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      else document.querySelector<HTMLSelectElement>('.cinema-stage-controls select')?.focus({ preventScroll: true });
    };
  }, [cinemaVisible, embeddedControls, attentionBlocked]);
  function skipFilm() { history.claim(viewedKey); setMain(null); setEntered(eventKey); }
  const endMain = useCallback((failed = false) => { if (test && !failed) history.claim(test.key); setMain(null); if (failed) setNotice('The film could not play. The story continues below.'); }, [test?.key, history]);
  const endPip = useCallback(() => { setPip(null); setEvidenceReady(eventKey); }, [eventKey]);
  const captions = <label className="cinema-caption-picker"><Captions aria-hidden="true"/><span className="cinema-sr-only">Closed captions</span><select aria-label="Closed captions" value={language} onChange={e => changeLanguage(e.target.value as CaptionLanguage)}><option value="off">CC Off</option><option value="en">English</option><option value="es">Español</option><option value="pt-BR">Português (Brasil)</option></select></label>;
  return <>
    <div className="cinema-gameplay" inert={cinemaVisible}>{children(room.phase === 'results' && cinemaVisible)}</div>
    {!test && <HostNarrator room={room} connected={connected} sound={sound} language={language} blocked={mainActive || awaitingEntry || !!pipClip || attentionBlocked} incidentalBlocked={clueRequesting || (cluePermit?.eventKey === attentionContext && evidenceReady !== eventKey)} evidenceReady={evidenceReady === eventKey && !!eventKey} onPlayback={onPlayback} onAttention={onAttention} onBusyChange={setNarratorBusy}/>}
    <div className="cinema-stage-controls">{captions}{event && !test && <span className="cinema-replay-hint">{t('Replay films from the game master’s phone.')}</span>}</div>
    {notice && <div className="cinema-notice" role="status"><Film aria-hidden="true"/>{notice}</div>}
    {cinemaVisible && <section ref={filmLayer} className="cinema-overlay" role={embeddedControls || attentionBlocked ? "region" : "dialog"} aria-modal={embeddedControls || attentionBlocked ? undefined : true} aria-label="Dustfall story film" onKeyDown={key => {
      if (key.key === 'Escape' && !(key.target instanceof HTMLSelectElement)) { key.preventDefault(); skipFilm(); }
      if (key.key !== 'Tab' || embeddedControls) return;
      const controls = filmLayer.current?.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled])');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (key.shiftKey && document.activeElement === first) { key.preventDefault(); last.focus(); }
      else if (!key.shiftKey && document.activeElement === last) { key.preventDefault(); first.focus(); }
    }}>
      {activeClip && active ? <CinematicVideo key={`${active.eventKey}:${active.serial}`} eventKey={playbackEventKey(room, active.eventKey)} clip={activeClip} language={preflightCaptionLanguage(room, language)} sound={sound} paused={room.timer.isPaused || !connected || attentionBlocked} onFinish={endMain} room={room} onPlayback={onPlayback}/> : <div className="cinema-loading" role="status"><Film/><span>{room.phase === 'results' ? 'The truth is coming…' : test ? stageCopy[interfaceLanguage].test : 'The next chapter begins…'}</span></div>}
      <div className="cinema-topbar"><span className="cinema-film-label"><Film aria-hidden="true"/>{test ? stageCopy[interfaceLanguage].test : activeClip?.title || 'Blood Moon over Dustfall'}</span><div>{!sound && <button onClick={() => void toggleSound()}><Volume2 aria-hidden="true"/> Enable sound</button>}<button className="cinema-skip" onClick={skipFilm}><SkipForward aria-hidden="true"/> Skip film</button></div></div>
      {test && <div className="cinema-preflight-note">{stageCopy[interfaceLanguage].testConfirm}</div>}
      {room.timer.isPaused && <div className="cinema-paused" role="status"><Pause/> Film paused by the game master</div>}
      <div className="cinema-overlay-captions">{captions}</div>
    </section>}
    {!active && pip && pipClip && <aside className="cinema-pip" aria-label="A new shared clue"><CinematicVideo key={`${pip.eventKey}:${pip.serial}`} eventKey={playbackEventKey(room, pip.eventKey)} clip={pipClip} language={language} sound={sound} paused={room.timer.isPaused || !connected || attentionBlocked} onFinish={endPip} onPlayback={onPlayback}/><button aria-label="Dismiss clue film" onClick={endPip}>×</button><span>New public evidence</span></aside>}
    <AttentionOverlay room={room} variant="host" connected={connected}/>
  </>;
}

interface VideoProps { eventKey: string; clip: CinematicClip; language: CaptionLanguage; sound: boolean; paused: boolean; onFinish: (failed?: boolean) => void; room?: RoomView; onPlayback?: PlaybackReporter }
function CinematicVideo({ eventKey, clip, language, sound, paused, onFinish, room, onPlayback }: VideoProps) {
  const video = useRef<HTMLVideoElement>(null);
  useNativePlayback(video, { eventKey, clipId: clip.id, kind: 'film' }, onPlayback, !paused);
  const [time, setTime] = useState(0), [started, setStarted] = useState(false), [needsGesture, setNeedsGesture] = useState(false), [audioBlocked, setAudioBlocked] = useState(false);
  const currentSound = useRef(sound);
  const ending = clip.id === 'caught' || clip.id === 'escaped-wrong' || clip.id === 'escaped-tie';
  const culprit = ending && room ? room.players.find(player => player.id === room.result?.culpritId) : undefined;
  const cues = language === 'pt-BR' ? clip.cues.ptBR : language === 'es' ? clip.cues.es || [] : language === 'en' ? clip.cues.en : [];
  const caption = captionAt(cues, time);
  const reveal = ending && time >= Math.min(4, clip.duration * .55);
  currentSound.current = sound;

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let disposed = false;
    const attempt = async () => {
      if (paused) { element.pause(); return; }
      element.muted = !sound;
      try { await element.play(); if (!disposed) { setNeedsGesture(false); setAudioBlocked(false); } }
      catch {
        if (disposed) return;
        element.muted = true;
        try { await element.play(); if (!disposed) { setNeedsGesture(false); setAudioBlocked(sound); } }
        catch (cause) { if (!disposed) setNeedsGesture(autoplayNeedsGesture(cause)); }
      }
    };
    void attempt();
    return () => { disposed = true; element.pause(); };
  }, [sound, paused, clip.src]);
  useEffect(() => watchFilmProgress({ started, paused, needsGesture }, () => onFinish(true)), [time, started, paused, needsGesture, onFinish]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    for (const track of Array.from(element.textTracks)) {
      const matching = language !== 'off' && track.language === language;
      track.mode = matching && !cues.length ? 'showing' : 'hidden';
    }
  }, [language, cues.length, started]);
  async function enablePlayback() {
    const element = video.current;
    if (!element || paused) return;
    try { element.muted = !currentSound.current; await element.play(); setNeedsGesture(false); setAudioBlocked(false); }
    catch (cause) { setNeedsGesture(autoplayNeedsGesture(cause)); }
  }
  return <div className="cinema-video-frame">
    <video ref={video} src={clip.src} poster={clip.poster || '/assets/dustfall-stage.webp'} playsInline preload="auto" muted={!sound} onPlaying={() => setStarted(true)} onTimeUpdate={e => { const next = e.currentTarget.currentTime; setTime(next); if (next >= clip.duration + .5) onFinish(); }} onEnded={() => onFinish()} onError={() => onFinish(true)} aria-label={clip.title}>
      {clip.captions.en && <track kind="captions" src={clip.captions.en} srcLang="en" label="English"/>}
      {clip.captions.es && <track kind="captions" src={clip.captions.es} srcLang="es" label="Español"/>}
      {clip.captions.ptBR && <track kind="captions" src={clip.captions.ptBR} srcLang="pt-BR" label="Português (Brasil)"/>}
    </video>
    {!started && <div className="cinema-buffering"><Film/><span>Loading the story…</span></div>}
    {(needsGesture || audioBlocked) && <button className="cinema-enable-play" disabled={paused} onClick={() => void enablePlayback()}><Volume2/>{needsGesture ? 'Play film' : 'Enable film sound'}</button>}
    {reveal && culprit && <div className="cinema-culprit-reveal"><CharacterPortrait character={playerCharacter(culprit)} decorative/><div><span>{clip.id === 'caught' ? 'The culprit is caught' : 'The culprit is revealed'}</span><strong>{culprit.name}</strong><p>{culprit.roleName || playerCharacter(culprit).name}</p></div></div>}
    {caption && <div className="cinema-captions" lang={language === 'off' ? 'en' : language} aria-live="off">{caption}</div>}
    <div className="cinema-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, 100 * time / clip.duration)}%` }}/></div>
  </div>;
}
