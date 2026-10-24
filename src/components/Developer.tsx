import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { gameStepIdentity } from '../../shared/game-step';
import { ArrowLeft, ArrowRight, ArrowUpRight, Captions, Check, ChevronDown, Clapperboard, Film, FlaskConical, LoaderCircle, Monitor, Pause, Play, Plus, RotateCcw, ShieldCheck, SkipForward, Smartphone, TriangleAlert, X } from 'lucide-react';
import type { Action, RoomView } from '../../shared/types';
import { CINEMATIC_IDS, captionAt, parseCinematicManifest, type CaptionLanguage, type CinematicClip } from '../../shared/cinematics';
import { formatTime } from '../../shared/format';
import { LanguageMenu, useLanguage } from '../i18n';

function DeveloperHeader({ page }: { page: 'dev' | 'films' }) {
  const { t } = useLanguage();
  return <header className="developer-header"><a className="developer-brand" href="/" aria-label={t('ALIBI home')}>✦ ALIBI <small>{t('PARTY ARCADE')}</small></a><nav aria-label={t('Developer navigation')}><a href="/dev" aria-current={page === 'dev' ? 'page' : undefined}>{t('Rehearsal')}</a><a href="/films" aria-current={page === 'films' ? 'page' : undefined}>{t('Film library')}</a></nav><LanguageMenu/></header>;
}

export function DeveloperStart({ connected, creating, error, onCreate, onOpen }: { connected: boolean; creating: boolean; error: string; onCreate: () => Promise<void>; onOpen?: (path: string) => void }) {
  const { t, language } = useLanguage();
  const id = useId();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const pending = useRef(false);
  async function create() {
    if (!connected || creating || pending.current) return;
    pending.current = true; setBusy(true); setFailure('');
    try { await onCreate(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : t('Couldn’t create your rehearsal. Try again.')); }
    finally { pending.current = false; setBusy(false); }
  }
  function resume(event: FormEvent) {
    event.preventDefault();
    if (/^[A-Z]{4}$/.test(code)) {
      const path = `/dev/${code}`;
      if (onOpen) onOpen(path); else window.location.assign(path);
    }
  }
  return <div className="developer-page" lang={language}><DeveloperHeader page="dev"/><main className="developer-start-main">
    <section className="developer-hero"><div className="developer-hero-art" aria-hidden="true"/><div className="developer-hero-copy"><span className="developer-kicker"><FlaskConical size={17}/> {t('DEVELOPER REHEARSAL')}</span><h1>{t('Run the show.')}<br/><em>{t('Try every turn.')}</em></h1><p>{t('The real Dustfall mystery, ready for one player. Keep the controls on this screen and your character on a phone.')}</p><button className="developer-button" disabled={!connected || creating || busy} onClick={() => void create()}>{creating || busy ? <LoaderCircle className="developer-spinner" size={20}/> : <Play size={20}/>} {t(creating || busy ? 'Creating your rehearsal…' : 'Create one-player rehearsal')}<ArrowRight size={21}/></button>
      {(error || failure) && <p className="developer-notice is-error" role="alert">{t(error || failure)}</p>}{!connected && <p className="developer-notice" role="status">{t('Reconnect to create a rehearsal room.')}</p>}<div className="developer-mode-note"><FlaskConical size={18}/><p>{t('Test rooms allow one player. Party games still need four.')}</p></div></div><div className="developer-hero-seal" aria-hidden="true"><Clapperboard size={39}/><strong>01</strong><span>{t('PLAYER TO BEGIN')}</span></div></section>
    <section className="developer-start-grid" aria-label={t('Rehearsal tools')}><article className="developer-panel"><span className="developer-kicker"><Monitor size={17}/> {t('THE WHOLE MYSTERY')}</span><h2>{t('Same story. Your pace.')}</h2><p>{t('Start with a real saved character. Read the dossier, search, share clues and answer case questions. Use Next to move through every act and ending.')}</p><ul className="developer-feature-list"><li><Check size={17}/>{t('One player to start · up to 20 to test')}</li><li><Check size={17}/>{t('Real films, evidence and phone actions')}</li><li><Check size={17}/>{t('Add sample players to test accusations')}</li></ul></article>
      <article className="developer-panel developer-resume"><span className="developer-kicker"><ShieldCheck size={17}/> {t('RETURN TO A TEST ROOM')}</span><h2>{t('Pick up your rehearsal.')}</h2><p>{t('Enter its room code in the browser that holds the game master controls. Only a rehearsal room can open these test controls.')}</p><form onSubmit={resume}><label htmlFor={`${id}-code`}>{t('Room code')}<input id={`${id}-code`} value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="TEST" maxLength={4} pattern="[A-Z]{4}" autoCapitalize="characters" autoComplete="off" spellCheck={false} required/></label><button className="developer-button secondary" type="submit">{t('Resume rehearsal')}<ArrowRight size={18}/></button></form></article>
    </section><a className="developer-film-ticket" href="/films"><span className="developer-ticket-icon"><Film size={35}/></span><span><small>{t('ALL 11 STORY FILMS')}</small><strong>{t('Take a seat in the screening room.')}</strong><span>{t('Browse every act, clue film and ending. Choose captions and press play.')}</span></span><ArrowUpRight size={28}/></a>
    <a className="developer-back" href="/"><ArrowLeft size={17}/>{t('Back to the arcade')}</a>
  </main></div>;
}

export function rehearsalNext(room: RoomView): { label: string; action: Action } {
  switch (room.phase) {
    case 'lobby': return { label: 'Start rehearsal', action: { type: 'start' } };
    case 'roles': return { label: 'Begin investigation', action: { type: 'advance' } };
    case 'investigation': return { label: room.round < room.settings.rounds ? 'Next act' : 'Open voting', action: { type: 'advance' } };
    case 'voting': return { label: 'Reveal results', action: { type: 'advance' } };
    case 'results': return { label: 'Reset rehearsal', action: { type: 'reset' } };
  }
}

function RehearsalReset({ busy, confirmDisabled, error, onCancel, onConfirm }: { busy: boolean; confirmDisabled: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useLanguage();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    element?.showModal(); element?.querySelector<HTMLButtonElement>('[data-rehearsal-cancel]')?.focus();
    return () => { element?.close(); before?.focus(); };
  }, []);
  return <dialog ref={dialog} className="developer-reset-dialog" aria-labelledby={id} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}><div className="developer-dialog-top"><FlaskConical size={21}/><button className="developer-icon-button" disabled={busy} aria-label={t('Close dialog')} onClick={onCancel}><X size={21}/></button></div><h2 id={id}>{t('Reset this rehearsal?')}</h2><p id={`${id}-description`}>{t('Everyone keeps their seat. Characters, clues, answers and votes are cleared. This run cannot be restored.')}</p>{error && <p className="developer-notice is-error" role="alert">{t(error)}</p>}<div className="developer-dialog-actions"><button data-rehearsal-cancel className="developer-button secondary" disabled={busy} onClick={onCancel}>{t('Keep this run')}</button><button className="developer-button" disabled={busy || confirmDisabled} onClick={onConfirm}>{t(busy ? 'Resetting…' : 'Reset rehearsal')}<RotateCcw size={17}/></button></div></dialog>;
}

/** These controls only call ordinary game actions after an authenticated mode check. */
export function RehearsalControls({ room, connected, command }: { room: RoomView; connected: boolean; command: (action: Action) => Promise<void> }) {
  const { t, language } = useLanguage();
  const stepIdentity = gameStepIdentity(room);
  const allowed = !!room.rehearsal && room.isMaster;
  const toolbar = useRef<HTMLElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reset, setReset] = useState(false);
  useEffect(() => { setReset(false); setError(''); }, [room.code, stepIdentity]);
  useEffect(() => { setError(''); }, [language]);
  useEffect(() => {
    if (!allowed || !toolbar.current) return;
    const element = toolbar.current, root = document.documentElement;
    const previous = root.style.getPropertyValue('--developer-toolbar-height');
    const measure = () => root.style.setProperty('--developer-toolbar-height', `${Math.ceil(element.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); if (previous) root.style.setProperty('--developer-toolbar-height', previous); else root.style.removeProperty('--developer-toolbar-height'); };
  }, [allowed]);
  if (!allowed) return null;
  const next = rehearsalNext(room);
  const disabled = !connected || busy;
  const nextDisabled = disabled || room.timer.isPaused || room.phase === 'lobby' && room.players.length === 0;
  const count = Math.min(4, Math.max(0, room.settings.maxPlayers - room.players.length));
  async function act(action: Action) {
    if (!connected || !room.isMaster || !room.rehearsal || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await command(action); if (action.type === 'reset') setReset(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('Couldn’t update the rehearsal. Try again.')); }
    finally { pending.current = false; setBusy(false); }
  }
  return <><section ref={toolbar} className="rehearsal-toolbar" aria-label={t('Developer rehearsal controls')} lang={language}>
    <div className="rehearsal-toolbar-inner"><div className="rehearsal-toolbar-main"><div className="rehearsal-room"><span className="rehearsal-label"><FlaskConical size={16}/>{t('TEST ROOM')} <b>{room.code}</b></span><strong>{room.phase === 'investigation' ? t('Act {round} of {total}', { round: room.round, total: room.settings.rounds }) : t(({ lobby: 'Lobby', roles: 'Characters', investigation: 'Investigation', voting: 'Final accusation', results: 'Results' })[room.phase])}</strong><small>{t(room.players.length === 1 ? '{count} player' : '{count} players', { count: room.players.length })} · {t(connected ? 'Connected' : 'Reconnecting')}</small></div>
      <button className="developer-button rehearsal-next" aria-label={t('Next step: {step}', { step: t(next.label) })} disabled={nextDisabled} onClick={() => next.action.type === 'reset' ? setReset(true) : void act(next.action)}><span><small>{t('NEXT STEP')}</small><strong>{t(busy ? 'One moment…' : next.label)}</strong></span><ArrowRight size={23}/></button>
      <div className="rehearsal-shortcuts"><a className="developer-button secondary" href={`/play/${room.code}`} target="_blank" rel="noreferrer"><Smartphone size={18}/><span>{t('Player phone')}</span><ArrowUpRight size={14}/></a><a className="developer-button secondary" href={`/screen/${room.code}`} target="_blank" rel="noreferrer"><Monitor size={18}/><span>{t('Public screen')}</span><ArrowUpRight size={14}/></a></div></div>
    <details className="rehearsal-more"><summary>{t('Playback and test tools')}<ChevronDown size={17}/></summary><div className="rehearsal-tool-row"><button className="developer-button secondary" disabled={disabled || room.phase === 'lobby'} onClick={() => void act({ type: room.timer.isPaused ? 'resume' : 'pause' })}>{room.timer.isPaused ? <Play size={17}/> : <Pause size={17}/>} {t(room.timer.isPaused ? 'Resume game' : 'Pause game')}</button><button className="developer-button secondary" disabled={disabled || room.phase === 'lobby'} onClick={() => void act({ type: 'presentation', control: 'replay' })}><RotateCcw size={17}/>{t('Replay film')}</button><button className="developer-button secondary" disabled={disabled || room.phase === 'lobby'} onClick={() => void act({ type: 'presentation', control: 'skip' })}><SkipForward size={17}/>{t('Skip film')}</button>
      {room.phase === 'lobby' && <button className="developer-button secondary" disabled={disabled || room.isLocked || count === 0} onClick={() => void act({ type: 'demo-fill' })}><Plus size={17}/>{t('Add {count} sample players', { count })}</button>}<a className="developer-button secondary" href={`/master/${room.code}`} target="_blank" rel="noreferrer"><ShieldCheck size={17}/>{t('GM phone controls')}<ArrowUpRight size={14}/></a><a className="developer-button secondary" href="/films" target="_blank" rel="noreferrer"><Film size={17}/>{t('Film library')}</a></div><p className="rehearsal-tool-note">{t('Next can skip unread roles and missing votes in this test room. Use sample players to test accusations against another character.')}</p></details>
    {room.phase === 'lobby' && room.players.length === 0 && <p className="rehearsal-toolbar-note" role="status">{t('Add a player before starting.')}</p>}{room.timer.isPaused && <p className="rehearsal-toolbar-note" role="status">{t('Resume the game before the next step.')}</p>}{error && !reset && <p className="rehearsal-toolbar-note is-error" role="alert">{t(error)}</p>}
    </div></section><div className="rehearsal-toolbar-space" aria-hidden="true"/>{reset && <RehearsalReset busy={busy} confirmDisabled={!connected || room.timer.isPaused} error={error} onCancel={() => setReset(false)} onConfirm={() => void act({ type: 'reset' })}/>}</>;
}

export function parseFilmLibrary(value: unknown): CinematicClip[] {
  const manifest = parseCinematicManifest(value);
  if (manifest.clips.length !== CINEMATIC_IDS.length) throw new Error('The complete film library is unavailable.');
  return CINEMATIC_IDS.map(id => manifest.clips.find(clip => clip.id === id)!);
}

const ending = (clip: CinematicClip) => clip.id === 'caught' || clip.id === 'escaped-wrong' || clip.id === 'escaped-tie';
function captionCues(clip: CinematicClip, language: CaptionLanguage) { return language === 'pt-BR' ? clip.cues.ptBR : language === 'es' ? clip.cues.es ?? [] : language === 'en' ? clip.cues.en : []; }

export function FilmPreview({ clip, captionLanguage }: { clip: CinematicClip; captionLanguage: CaptionLanguage }) {
  const { t, language } = useLanguage();
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [failed, setFailed] = useState(false);
  const caption = captionAt(captionCues(clip, captionLanguage), time);
  const transcriptLanguage = captionLanguage === 'off' ? language : captionLanguage;
  const transcript = captionCues(clip, transcriptLanguage);
  useEffect(() => {
    const element = video.current;
    return () => { element?.pause(); };
  }, [clip.id]);
  return <section className="film-preview" aria-label={t('Selected film')}>
    <div className="film-video-frame"><video ref={video} key={clip.id} src={clip.src} poster={clip.poster ?? '/assets/dustfall-stage.webp'} controls playsInline preload="metadata" aria-label={t(clip.title)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onSeeked={event => setTime(event.currentTarget.currentTime)} onError={() => setFailed(true)}/><div className={`film-caption-overlay${caption ? ' has-caption' : ''}`} lang={captionLanguage === 'off' ? language : captionLanguage} aria-live="off">{caption}</div></div>
    {failed && <div className="developer-notice is-error" role="alert"><p>{t('This film could not load. Retry it here, or open the original MP4 below.')}</p><button className="developer-button secondary" onClick={() => { setFailed(false); setTime(0); video.current?.load(); }}><RotateCcw size={17}/>{t('Retry film')}</button></div>}
    <div className="film-selected-heading"><div><span className="developer-kicker">{t(ending(clip) ? 'ENDING SPOILERS' : 'NOW SELECTED')}</span><h2>{t(clip.title)}</h2></div><time>{formatTime(clip.duration)}</time></div>
    <p className="film-play-note"><Play size={16}/>{t('Press play when you’re ready. Sound starts only when you choose.')}</p><a className="developer-inline-link" href={clip.src} target="_blank" rel="noreferrer">{t('Open original MP4')}<ArrowUpRight size={17}/></a>
    <details className="film-transcript"><summary>{t('Read transcript')}<ChevronDown size={17}/></summary><ol lang={transcriptLanguage}>{transcript.map((cue, index) => <li key={`${cue.start}:${index}`}><time>{formatTime(cue.start)}</time><p>{cue.text}</p></li>)}</ol>{transcript.length === 0 && <p>{t('No transcript is available in this caption language.')}</p>}</details>
  </section>;
}

export function FilmGallery({ clips }: { clips: CinematicClip[] }) {
  const { t } = useLanguage();
  const [selectedId, setSelectedId] = useState(clips[0].id);
  const [captionLanguage, setCaptionLanguage] = useState<CaptionLanguage>('off');
  const selected = clips.find(clip => clip.id === selectedId) ?? clips[0];
  return <div className="film-gallery"><aside className="film-programme" aria-label={t('Choose a story film')}><div className="film-programme-heading"><Clapperboard size={20}/><h2>{t('The programme')}</h2><span>11</span></div><ol>{clips.map((clip, index) => <li key={clip.id}><button className={`film-choice${selected.id === clip.id ? ' is-selected' : ''}${ending(clip) ? ' is-ending' : ''}`} data-film-id={clip.id} aria-pressed={selected.id === clip.id} onClick={() => setSelectedId(clip.id)}><span className="film-choice-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{t(clip.title)}</strong><small>{t(ending(clip) ? 'Ending spoilers' : clip.id === 'opening' ? 'Opening film' : clip.id === 'clue' ? 'Shared clue' : clip.id === 'voting' ? 'Accusations' : 'Story act')} · {formatTime(clip.duration)}</small></span>{selected.id === clip.id ? <Play size={17}/> : <Film size={15}/>}</button></li>)}</ol></aside>
    <div className="film-screening"><div className="film-caption-toolbar"><label><Captions size={19}/><span>{t('Captions')}</span><select value={captionLanguage} onChange={event => setCaptionLanguage(event.target.value as CaptionLanguage)} aria-label={t('Film captions')}><option value="off">{t('Off')}</option><option value="en">English</option><option value="es">Español</option><option value="pt-BR">Português (Brasil)</option></select></label><span>{t('11 films · choose any scene')}</span></div><FilmPreview key={selected.id} clip={selected} captionLanguage={captionLanguage}/></div>
  </div>;
}

export function FilmLibrary() {
  const { t, language } = useLanguage();
  const [clips, setClips] = useState<CinematicClip[]>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setFailed(false); setClips(undefined);
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    void fetch('/media/cinematics.json', { signal: controller.signal }).then(response => { if (!response.ok) throw new Error('Film library unavailable'); return response.json() as Promise<unknown>; }).then(value => { const available = parseFilmLibrary(value); if (active) setClips(available); }).catch(() => { if (active) setFailed(true); }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [retry]);
  return <div className="developer-page film-library-page" lang={language}><DeveloperHeader page="films"/><main className="film-library-main"><header className="film-library-heading"><span className="developer-kicker"><Film size={18}/> {t('DUSTFALL / FILM LIBRARY')}</span><h1>{t('Every scene.')}<br/><em>{t('All the secrets.')}</em></h1><p>{t('Watch the existing story films in your own time. Pick a scene, choose your captions and press play.')}</p><div className="film-spoiler-notice"><TriangleAlert size={20}/><span><strong>{t('Ending spoilers')}</strong>{t('The final three films reveal the possible verdicts. Save them for after your first mystery.')}</span></div></header>
    {clips ? <FilmGallery clips={clips}/> : <section className={`film-library-loading${failed ? ' is-error' : ''}`} aria-busy={!failed} aria-label={t('Film library')}><Clapperboard size={40}/>{failed ? <><h2>{t('The screening room is taking a moment.')}</h2><p role="alert">{t('The film list could not load. Check your connection and try again, or open the manifest below.')}</p><button className="developer-button" onClick={() => setRetry(value => value + 1)}><RotateCcw size={18}/>{t('Retry film library')}</button></> : <><LoaderCircle className="developer-spinner" size={22}/><p role="status">{t('Loading the film library…')}</p></>}</section>}
    <footer className="film-library-footer"><a className="developer-inline-link" href="/media/cinematics.json" target="_blank" rel="noreferrer">{t('Open film manifest')}<ArrowUpRight size={17}/></a><a className="developer-inline-link" href="/dev"><FlaskConical size={17}/>{t('Try the full rehearsal')}<ArrowRight size={17}/></a><a className="developer-inline-link" href="/"><ArrowLeft size={17}/>{t('Back to the arcade')}</a></footer>
  </main></div>;
}
