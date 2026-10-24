import { HostPreflight } from './HostPreflight';
import { StageControls } from './StageControls';
import { FunAwards } from './FunAwards';
import { watchCopy } from '../watch-translations';
import { useEffect, useRef, useState } from 'react';
import { gameStepIdentity } from '../../shared/game-step';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, Fingerprint, LockKeyhole, Monitor, MoreHorizontal, Pause, Play, Plus, RotateCcw, SkipForward, Settings2, ShieldCheck, Trash2, UnlockKeyhole, Users } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Action, Gender, PlayerView, RoomView, Settings } from '../../shared/types';
import { GENDERS, PHASES } from '../../shared/types';
import { CHARACTERS, characterById, entrySeal } from '../../shared/characters';
import { Clock } from './Clock';
import { GameMasterStatus, MasterRecovery } from './RoomRecovery';
import { AttentionOverlay } from './AttentionOverlay';
import { ScreenPlaybackStatus } from './ScreenPlaybackStatus';
import { Modal } from './Modal';
import { LanguageMenu, useLanguage } from '../i18n';

type MasterProps = {
  room: RoomView;
  connected: boolean;
  command: (action: Action) => Promise<void>;
  joinOrigin: string;
  onHome: () => void;
};
export function preferenceActions(player: PlayerView, gender: Gender, roleName: string): Action[] {
  const actions: Action[] = [];
  const changingGender = player.gender !== gender;
  const oldRole = player.roleName ?? '';
  if (changingGender && oldRole) actions.push({ type: 'set-role', playerId: player.id, roleName: '' });
  if (changingGender) actions.push({ type: 'set-gender', playerId: player.id, gender });
  if (changingGender ? !!roleName : oldRole !== roleName) actions.push({ type: 'set-role', playerId: player.id, roleName });
  return actions;
}

type Panel = 'settings' | 'player' | 'kick' | 'advance' | 'reset' | null;

export function getMasterAction(room: RoomView): { label: string; action: Action; disabled: boolean } {
  switch (room.phase) {
    case 'lobby':
      return { label: 'Start the mystery', action: { type: 'start' }, disabled: room.players.length < (room.rehearsal ? 1 : 4) };
    case 'roles':
      return { label: 'Begin investigation', action: { type: 'advance' }, disabled: room.timer.isPaused || room.players.some(player => !player.ready) };
    case 'investigation':
      return { label: room.round < room.settings.rounds ? 'Next round' : 'Open voting', action: { type: 'advance' }, disabled: room.timer.isPaused };
    case 'voting':
      return { label: 'Reveal the truth', action: { type: 'advance' }, disabled: room.timer.isPaused || room.votesCount < room.players.length };
    case 'results':
      return { label: 'New mystery', action: { type: 'reset' }, disabled: false };
  }
}

export function Master({ room, connected, command, joinOrigin, onHome }: MasterProps) {
  const { t, language } = useLanguage();
  const stepIdentity = gameStepIdentity(room);
  const minimumPlayers = room.rehearsal ? 1 : 4;
  const sealLabel = (id: string) => { const seal = entrySeal(id); return `${t(seal.color)} ${t(seal.symbol)}`; };
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [timeExtended, setTimeExtended] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [managed, setManaged] = useState<PlayerView | null>(null);
  const [gender, setGender] = useState<Gender>('any');
  const [roleName, setRoleName] = useState('');
  const [settings, setSettings] = useState<Settings>(room.settings);
  const disabled = !connected || !!busy || !room.isMaster;
  const origin = joinOrigin.replace(/\/+$/, '');
  const joinUrl = `${origin}/join/${room.code}`;
  const displayUrl = `${origin}/screen/${room.code}`;
  const watchUrl = `${origin}/watch/${room.code}`;
  const next = getMasterAction(room);
  const phaseIndex = PHASES.findIndex(phase => phase.id === room.phase);
  const readyCount = room.players.filter(player => player.ready).length;
  const publicClues = room.clues.filter(clue => clue.published);
  const isLive = room.phase !== 'lobby';
  const missingResponses = room.phase === 'roles' ? readyCount < room.players.length : room.phase === 'voting' && room.votesCount < room.players.length;
  const missingCount = room.players.length - (room.phase === 'roles' ? readyCount : room.votesCount);
  const freeSeats = room.settings.maxPlayers - room.players.length;

  useEffect(() => { setPanel(null); setError(''); setManaged(null); }, [room.code, stepIdentity]);
  useEffect(() => { setError(''); }, [language]);
  useEffect(() => { setTimeExtended(false); }, [room.code, stepIdentity]);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  function open(nextPanel: Panel) {
    setError('');
    if (nextPanel === 'settings') setSettings({ ...room.settings });
    setPanel(nextPanel);
  }
  async function act(action: Action, close = false, rejectFailure = false) {
    if (disabled || pending.current) { if (rejectFailure) throw new Error(t("Reconnecting to your room. Try again in a moment.")); return; }
    pending.current = true;
    setBusy(action.type); setError('');
    if (action.type === 'extend-time') setTimeExtended(false);
    try { await command(action); if (action.type === 'extend-time') setTimeExtended(true); if (close) setPanel(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Couldn’t update the room. Try again.")); if (rejectFailure) throw cause; }
    finally { pending.current = false; setBusy(null); }
  }
  const partyAction = (action: Action) => act(action, false, true);
  async function copy(value: string, key: string) {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(value);
      else {
        const field = document.createElement('textarea');
        field.value = value;
        field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field); field.select();
        try {
          if (!document.execCommand('copy')) throw new Error(t("Select and copy the link or room code below."));
        } finally { field.remove(); }
      }
      setCopied(key);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Select and copy the link or room code below.")); }
  }
  function manage(player: PlayerView) {
    setManaged(player); setGender(player.gender); setRoleName(player.roleName ?? ''); open('player');
  }
  async function savePlayer() {
    if (!managed || disabled || pending.current) return;
    pending.current = true;
    setBusy('player'); setError('');
    try {
      for (const action of preferenceActions(managed, gender, roleName)) await command(action);
      setPanel(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Couldn’t save this character preference. Try again.")); }
    finally { pending.current = false; setBusy(null); }
  }
  function primaryAction() {
    if (disabled || next.disabled) return;
    if (next.action.type === 'reset') open('reset');
    else void act(next.action);
  }

  const title = room.phase === 'lobby' ? t("Gather your suspects.")
    : room.phase === 'roles' ? t("Secrets, delivered.")
      : room.phase === 'investigation' ? t("Follow the evidence.")
        : room.phase === 'voting' ? t("Call the accusation.") : t("The truth is out.");
  const nextHint = room.timer.isPaused && room.phase !== 'results' ? t("Resume the game before continuing.")
    : room.phase === 'lobby' ? room.players.length < minimumPlayers ? t(minimumPlayers - room.players.length === 1 ? "{count} more player needed to begin." : "{count} more players needed to begin.", { count: minimumPlayers - room.players.length }) : t("Everyone here? Deal their private characters.")
      : room.phase === 'roles' ? t("{ready} of {total} players ready.", { ready: readyCount, total: room.players.length })
        : room.phase === 'voting' ? t("{votes} of {total} votes received.", { votes: room.votesCount, total: room.players.length })
          : room.phase === 'investigation' ? t("The timer is your cue. You decide when to move on.") : t("Keep the players. Deal a fresh set of secrets.");

  return <div className="gm-page" lang={language}><div className="gm-shell">
    <header className="gm-header">
      <div className="gm-header-top"><button className="gm-brand" onClick={onHome} aria-label={t("ALIBI home")}>ALIBI<span>®</span></button><span className="gm-master-badge"><ShieldCheck size={16} /> {t("GM")}</span></div>
      <div className="gm-room-bar"><span>{t("ROOM")} <strong>{room.code}</strong></span><span className={`gm-connection ${connected ? '' : 'is-offline'}`} role="status"><span />{connected ? t("Connected") : t("Reconnecting")}</span></div>
      <div className="gm-language-row"><span>{t("Language")}</span><LanguageMenu /></div>
    </header>

    <main className="gm-main">
      <AttentionOverlay room={room} connected={connected} variant="master" />
      <div className="gm-heading"><p className="gm-private-label">{t("Game master / private phone controls")}</p><div className="gm-phase-line"><span className="gm-phase-dots" aria-label={t("Phase {current} of {total}: {phase}", { current: phaseIndex + 1, total: PHASES.length, phase: t(PHASES[phaseIndex]?.label ?? '') })}>{PHASES.map((phase, index) => <span className={index <= phaseIndex ? 'is-filled' : ''} key={phase.id} />)}</span><span>{String(phaseIndex + 1).padStart(2, '0')} / 05</span></div><h1>{title}</h1></div>

      {!connected && <div className="gm-notice" role="status">{t("Reconnecting to your room. Controls will return when the connection is restored.")}</div>}
      {!room.isMaster && <div className="gm-notice" role="alert">{t("Reconnect with your game master session to control this room.")}</div>}
      {error && !panel && <div className="gm-notice is-error" role="alert">{t(error)}</div>}

      <section className={`gm-stage ${room.timer.isPaused ? 'is-paused' : ''}`} aria-label={t("Current game status")}>
        {room.phase === 'lobby' && <>
          <div className="gm-stage-top"><span className="gm-label">{t("THE TABLE")}</span><Users size={21} strokeWidth={1.5} /></div>
          <div className="gm-lobby-count"><strong>{room.players.length}</strong><span>{t("of {total} seats filled", { total: room.settings.maxPlayers })}<br />{t(room.rehearsal ? "Developer rehearsal · 1–20 test players." : "4–20 players · one separate GM")}</span></div>
          <div className="gm-stage-bottom"><span className="gm-room-state">{room.isLocked ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}{room.isLocked ? t("Room locked") : t("Open for joining")}</span><button className="gm-inline-button" disabled={disabled} onClick={() => void act({ type: 'lock', locked: !room.isLocked })}>{room.isLocked ? t("Unlock room") : t("Lock room")}</button></div>
        </>}
        {room.phase === 'roles' && <>
          <div className="gm-stage-top"><span className="gm-label">{t("PRIVATE CHARACTERS")}</span><Fingerprint size={23} strokeWidth={1.4} /></div>
          <h2>{readyCount} <span>{t("of {total} ready", { total: room.players.length })}</span></h2>
          <progress className="gm-progress" value={readyCount} max={Math.max(1, room.players.length)} aria-label={t("Players who have read their character")} />
          <p>{t("Ask guests to read Profile, Secrets and Missions on their own phone, then tap I’m ready. Keep their private files discreet.")}</p>
        </>}
        {room.phase === 'investigation' && <>
          <div className="gm-stage-top"><span className="gm-label">{t("ROUND {round} OF {total}", { round: room.round, total: room.settings.rounds })}</span><span className="gm-live-label"><span />{room.timer.isPaused ? t("Paused") : t("Investigation")}</span></div>
          <h2 className="gm-act-title">{room.act?.title ?? t("The Dustfall investigation")}</h2><div className="gm-timer-controls"><div className="gm-timer" role="timer" aria-label={t("Time remaining")}><Clock timer={room.timer} serverNow={room.serverNow} /></div><button className="gm-button gm-secondary gm-extra-time" aria-describedby="gm-extra-time-hint" disabled={disabled || room.timer.remaining >= 600} onClick={() => void act({ type: 'extend-time' })}><Plus size={17}/>{busy === 'extend-time' ? t("One moment…") : t("Add 1 minute")}</button></div><p id="gm-extra-time-hint" className="gm-time-hint">{room.timer.remaining >= 600 ? t("The countdown is at the ten-minute limit.") : t("Add up to one minute. The countdown limit is ten minutes.")}</p>{timeExtended && <p className="gm-time-receipt" role="status"><Check size={15}/>{t("The investigation timer was extended.")}</p>}
          <div className="gm-action-counts"><span><strong>{room.searchCount ?? 0}/{room.players.length}</strong> {t("searched")}</span><span><strong>{room.answerCount ?? 0}/{room.players.length}</strong> {t("answered")}</span><span><strong>{publicClues.filter(clue => clue.round === room.round).length}</strong> {t("clues shared this act")}</span></div><p>{room.timer.isPaused ? t("The timer and player actions are on hold.") : room.round === room.settings.rounds ? t("The final round. Let the table compare its evidence.") : t("Let the clues surface. Let the suspicion build.")}</p>
        </>}
        {room.phase === 'voting' && <>
          <div className="gm-stage-top"><span className="gm-label">{t("PRIVATE ACCUSATIONS")}</span><LockKeyhole size={21} strokeWidth={1.5} /></div>
          <h2>{room.votesCount} <span>{t("of {total} votes", { total: room.players.length })}</span></h2>
          <progress className="gm-progress" value={room.votesCount} max={Math.max(1, room.players.length)} aria-label={t("Accusations received")} />
          <p>{t("Votes stay sealed until you reveal the truth.")}</p>
        </>}
        {room.phase === 'results' && <>
          <div className="gm-stage-top"><span className="gm-label">{t("THE VERDICT")}</span><Fingerprint size={23} strokeWidth={1.4} /></div>
          <h2>{room.result?.caught ? t("Caught in the act.") : t("A perfect getaway.")}</h2>
          {room.result ? <p>{t("The culprit was {name}.", { name: room.players.find(player => player.id === room.result!.culpritId)?.name ?? t("the revealed suspect") })} {room.result.caught ? t("The table found its culprit.") : t("A tie or an incorrect accusation lets the culprit escape.")}</p> : <p>{t("Waiting for the final result.")}</p>}
        </>}
        {isLive && <div className="gm-live-tools"><span>{room.timer.isPaused ? t("Game paused") : t("You set the pace")}</span><button className="gm-button gm-secondary" disabled={disabled} onClick={() => void act({ type: room.timer.isPaused ? 'resume' : 'pause' })}>{room.timer.isPaused ? <Play size={16} /> : <Pause size={16} />}{room.timer.isPaused ? t("Resume game") : t("Pause game")}</button></div>}
      </section>
      <HostPreflight room={room} connected={connected} disabled={disabled} onAction={partyAction}/><StageControls room={room} connected={connected} disabled={disabled} onAction={partyAction}/><FunAwards room={room} connected={connected} disabled={disabled} onAction={partyAction}/>
      <ScreenPlaybackStatus room={room} connected={connected} /><GameMasterStatus room={room}/><details className="gm-card gm-recovery-settings"><summary><span><ShieldCheck size={18}/>{t("Game master and recovery")}</span><ChevronDown size={18}/></summary><div className="gm-details-body"><MasterRecovery room={room} connected={connected}/></div></details>

      {room.act && (room.phase === 'investigation' || room.phase === 'voting') && <section className="gm-card gm-narration"><div className="gm-card-heading"><h2>{t("Read aloud · Act {round}", { round: room.round })}</h2><span>{t("PUBLIC STORY")}</span></div><h3>{room.act.title}</h3><p>{room.act.narration}</p><div className="gm-discussion"><strong>{t("ASK THE TABLE")}</strong><p>{room.act.prompt}</p></div></section>}
      {room.act && room.act.evidence.length > 0 && <details className="gm-card gm-case-evidence" open={room.phase === 'investigation'}><summary><span>{t("Automatic case evidence")}</span><span className="gm-summary-end">{room.act.evidence.length}<ChevronDown size={18} /></span></summary><div className="gm-details-body">{room.act.evidence.map(evidence => <article className="gm-clue" key={evidence.id}><div><span>{t("AVAILABLE TO EVERYONE")}</span></div><h3>{evidence.title}</h3><p>{evidence.text}</p></article>)}</div></details>}
      {room.questionResult && <details className="gm-card"><summary><span>{t("Act {round} · Answer explained", { round: room.questionResult.round })}</span><ChevronDown size={18} /></summary><div className="gm-details-body"><p>{room.questionResult.explanation}</p></div></details>}
      {room.phase === 'results' && room.result && <section className="gm-card gm-tallies"><div className="gm-card-heading"><h2>{t("The accusations")}</h2><span>{t("{votes} votes", { votes: room.votesCount })}</span></div>{[...room.players].sort((a, b) => (room.result!.tallies[b.id] ?? 0) - (room.result!.tallies[a.id] ?? 0)).map(player => <div className="gm-tally" key={player.id}><div><span>{player.name}{player.id === room.result!.culpritId && <small>{t("CULPRIT")}</small>}</span><strong>{t((room.result!.tallies[player.id] ?? 0) === 1 ? "{votes} vote" : "{votes} votes", { votes: room.result!.tallies[player.id] ?? 0 })}</strong></div><div className="gm-tally-track"><span style={{ width: `${((room.result!.tallies[player.id] ?? 0) / Math.max(1, room.players.length)) * 100}%` }} /></div></div>)}</section>}

      {room.phase === 'results' && room.result?.solution && <details className="gm-card gm-solution"><summary><span>{t("The full solution")}</span><ChevronDown size={18} /></summary><div className="gm-details-body"><h3>{room.result.solution.headline}</h3><p>{room.result.solution.summary}</p><h3>{t("The method")}</h3><p>{room.result.solution.method}</p><h3>{t("The motive")}</h3><p>{room.result.solution.motive}</p><ol>{room.result.solution.timeline.map((entry, index) => <li key={index}><strong>{entry.time}</strong><p>{entry.text}</p></li>)}</ol></div></details>}
      <section className="gm-card gm-display-card"><div className="gm-card-heading"><h2><Monitor size={18} /> {t("Public display")}</h2><ArrowUpRight size={18} /></div><p>{t("Open public display on computer/TV")}</p><a className="gm-display-url" href={displayUrl} target="_blank" rel="noreferrer">{displayUrl}<ArrowUpRight size={16} /></a><button className="gm-button gm-secondary" onClick={() => void copy(displayUrl, 'display')}>{copied === 'display' ? <Check size={16} /> : <Copy size={16} />}{copied === 'display' ? t("Display link copied") : t("Copy display link")}</button><div className="gm-film-controls"><h3>{t("Story films")}</h3><p>{t("Films play automatically as the story advances. Pause game also pauses the film.")}</p><div className="gm-film-buttons"><button className="gm-button gm-secondary" disabled={disabled || room.phase === 'lobby'} onClick={() => void act({ type: 'presentation', control: 'skip' })}><SkipForward size={17}/>{t("Skip current film")}</button><button className="gm-button gm-secondary" disabled={disabled || room.phase === 'lobby'} onClick={() => void act({ type: 'presentation', control: 'replay' })}><RotateCcw size={17}/>{t("Replay current film")}</button></div><label className="gm-field gm-film-captions">{t("Public screen captions")}<select value={room.captionLanguage ?? 'off'} disabled={disabled} onChange={event => void act({ type: 'captions', language: event.target.value as 'off' | 'en' | 'es' | 'pt-BR' })}><option value="off">{t("Off")}</option><option value="en" lang="en">English</option><option value="es" lang="es">Español</option><option value="pt-BR" lang="pt-BR">Português (Brasil)</option></select></label><button className="gm-button gm-secondary gm-full-width" disabled={disabled} onClick={() => void act({ type: 'captions', language: room.captionLanguage ?? 'off' })}><Monitor size={16}/>{t("Apply captions to TV")}</button><span>{t("Enable sound using the sound button on the public screen.")}</span></div></section>

      <details className="gm-card gm-invite"><summary><span><Users size={18} /> {t("Invite players")}</span><span className="gm-summary-end">{room.code}<ChevronDown size={18} /></span></summary><div className="gm-details-body"><p>{t("Players scan this code or open the invitation on their own phones.")}</p><div className="gm-invitation"><div className="gm-qr"><QRCodeSVG value={joinUrl} size={136} level="M" bgColor="#FFF0CB" fgColor="#130C25" title={t("Join ALIBI room {code}", { code: room.code })} /></div><div className="gm-invite-code"><span>{t("ROOM CODE")}</span><strong>{room.code}</strong><button className="gm-inline-button" onClick={() => void copy(room.code, 'code')}>{copied === 'code' ? <Check size={15} /> : <Copy size={15} />}{copied === 'code' ? t("Code copied") : t("Copy code")}</button></div></div><a className="gm-invite-url" href={joinUrl} target="_blank" rel="noreferrer">{joinUrl}</a><button className="gm-button gm-secondary gm-full-width" onClick={() => void copy(joinUrl, 'invite')}>{copied === 'invite' ? <Check size={16} /> : <Copy size={16} />}{copied === 'invite' ? t("Invitation copied") : t("Copy player invitation")}</button><div className="gm-audience-invite"><h3>{watchCopy(language).invite}</h3><p>{watchCopy(language).note}</p><a className="gm-invite-url" href={watchUrl} target="_blank" rel="noreferrer">{watchUrl}</a><button className="gm-button gm-secondary gm-full-width" onClick={() => void copy(watchUrl, 'audience')}>{copied === 'audience' ? <Check size={16}/> : <Copy size={16}/>} {copied === 'audience' ? t('Invitation copied') : watchCopy(language).copy}</button></div></div></details>

      <details className="gm-card gm-roster" open={room.phase === 'lobby' || room.phase === 'roles'}><summary><span><Users size={18} /> {t("The suspects")}</span><span className="gm-summary-end">{room.players.length} / {room.settings.maxPlayers}<ChevronDown size={18} /></span></summary><div className="gm-details-body">
        {room.players.length === 0 ? <p className="gm-empty">{t("Your first suspect is one invitation away. Share the room code to get everyone in.")}</p> : <ul className="gm-roster-list">{room.players.map((player, index) => <li className="gm-person" key={player.id}><span className={`gm-avatar gm-tone-${index % 3}`}>{player.characterId && characterById(player.characterId) ? <img src={characterById(player.characterId)!.portrait} alt="" /> : player.name.slice(0, 1).toUpperCase()}</span><div className="gm-person-copy"><strong>{player.name}</strong><span>{room.phase === 'lobby' ? player.roleName ?? t(GENDERS.find(option => option.value === player.gender)?.label ?? 'Either') : player.roleName ?? t("Character assigned")}</span>{player.characterId && characterById(player.characterId) && <span className="gm-entry-seal">{t("Public seal · {seal}", { seal: sealLabel(player.characterId) })}</span>}<span className={`gm-player-status ${!player.connected ? 'is-away' : ''}`}><span />{!player.connected ? t("Disconnected") : room.phase === 'roles' ? player.ready ? t("Ready") : t("Reading role") : t("Connected")}{!player.connected && room.phase === 'roles' && player.ready ? ` · ${t('Ready')}` : ''}</span></div>{room.phase === 'lobby' && <button className="gm-icon-button" aria-label={t("Manage {name}", { name: player.name })} disabled={disabled} onClick={() => manage(player)}><MoreHorizontal size={22} /></button>}</li>)}</ul>}
        {room.phase === 'lobby' && <div className="gm-roster-bottom"><button className="gm-button gm-secondary gm-full-width" disabled={disabled || room.isLocked || freeSeats === 0} onClick={() => void act({ type: 'demo-fill' })}><Plus size={16} />{t("Add {count} sample players", { count: Math.min(4, Math.max(0, freeSeats)) })}</button><p>{room.isLocked ? t("Unlock the room to add sample players.") : t("Sample players let you rehearse the evening.")}</p></div>}
      </div></details>

      {(isLive || publicClues.length > 0 || room.phase === 'results') && <details className="gm-card gm-evidence"><summary><span>{t("Shared evidence")}</span><span className="gm-summary-end">{publicClues.length}<ChevronDown size={18} /></span></summary><div className="gm-details-body">{publicClues.length === 0 ? <p className="gm-empty">{t("No public clues yet. Players choose what to share.")}</p> : publicClues.map(clue => <article className="gm-clue" key={clue.id}><div><span>{clue.playerName}</span><span>{t("Round {round}", { round: clue.round })}</span></div><h3>{clue.title}</h3><p>{clue.text}</p></article>)}</div></details>}

      {room.phase === 'lobby' ? <button className="gm-settings-button" disabled={disabled} onClick={() => open('settings')}><Settings2 size={19} /><span><strong>{t("Room settings")}</strong><span>{t("{rounds} rounds · {seconds}s each · {players} players", { rounds: room.settings.rounds, seconds: room.settings.roundSeconds, players: room.settings.maxPlayers })}</span></span><ArrowRight size={18} /></button> : <button className="gm-inline-button gm-reset" disabled={disabled} onClick={() => open('reset')}><RotateCcw size={16} />{t("Reset to lobby")}</button>}
      <details className="gm-card gm-host-guide"><summary><span>{t("Host’s quick guide")}</span><ChevronDown size={18} /></summary><div className="gm-details-body"><p><strong>{t(room.rehearsal ? "Developer rehearsal · 1–20 test players." : "4–20 guests + you on this separate GM phone.")}</strong> {t("Open the public display on a computer or TV. Guests keep their character, private clues and actions on their own phone.")}</p><p>{t("Three acts at five minutes each is the recommended pace. Read each act’s narration aloud, allow time for one search and one case answer per guest, then encourage conversation before advancing.")}</p><p>{t("Search: +25. Share an assigned clue: +25. Correct case answer: +100 when the act closes. Final correct accusation: +200. Culprit escape: +200. Scores are lighthearted awards.")}</p><p>{t("Anonymous suspicion can change during each act. Final accusations stay sealed and cannot change. Pause holds the clock and player actions. Advancing past missing responses asks you to confirm.")}</p></div></details>
      <p className="gm-bottom-note"><ShieldCheck size={16} />{t("The secrets stay on your players’ phones.")}</p>
    </main>

    <footer className="gm-next"><div className="gm-next-copy"><span className="gm-label">{t("YOUR NEXT MOVE")}</span><p>{nextHint}</p></div><button className="gm-button gm-primary gm-full-width" disabled={disabled || next.disabled} onClick={primaryAction}>{busy === next.action.type ? t("One moment…") : t(next.label)}<ArrowRight size={18} /></button>{missingResponses && <button className="gm-inline-button gm-override" disabled={disabled || room.timer.isPaused} onClick={() => open('advance')}>{t("Continue without everyone")}<ArrowRight size={16} /></button>}</footer>
  </div>

    {panel && <Modal title={panel === 'settings' ? t("Room settings") : panel === 'player' ? t("Manage {name}", { name: managed?.name ?? t('player') }) : panel === 'kick' ? t("Remove {name}?", { name: managed?.name ?? t("this player") }) : panel === 'advance' ? t("Continue without everyone?") : t("Start a new mystery?")} onClose={() => { if (!busy) setPanel(null); }}>
      {error && <div className="gm-notice is-error" role="alert">{t(error)}</div>}
      {panel === 'settings' && <form className="gm-form" onSubmit={event => { event.preventDefault(); if (room.phase === 'lobby') void act({ type: 'settings', settings }, true); }}><p>{t("Set the pace before you deal the characters.")}</p><fieldset disabled={disabled}><label className="gm-field">{t("Investigation rounds")}<select value={settings.rounds} onChange={event => setSettings({ ...settings, rounds: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map(number => <option key={number} value={number}>{t(number === 1 ? "{count} round" : "{count} rounds", { count: number })}</option>)}</select></label><label className="gm-field">{t("Seconds per round")}<input type="number" inputMode="numeric" value={settings.roundSeconds} required min={60} max={600} step={1} onChange={event => setSettings({ ...settings, roundSeconds: Number(event.target.value) })} /><span>{t("60–600 seconds")}</span></label><label className="gm-field">{t("Maximum players")}<input type="number" inputMode="numeric" value={settings.maxPlayers} required min={Math.max(4, room.players.length)} max={20} step={1} onChange={event => setSettings({ ...settings, maxPlayers: Number(event.target.value) })} /><span>{t("4–20 players. Keep enough seats for your current cast.")}</span></label><button className="gm-button gm-primary gm-full-width" type="submit">{busy === 'settings' ? t("Saving…") : t("Save settings")}<Check size={18} /></button></fieldset></form>}
      {panel === 'player' && managed && <div className="gm-form"><p>{t("These are character preferences for the story.")}</p><fieldset disabled={disabled}><label className="gm-field">{t("Character gender")}<select value={gender} onChange={event => { const nextGender = event.target.value as Gender; setGender(nextGender); const selected = CHARACTERS.find(character => character.name === roleName); if (selected && (nextGender === 'man' || nextGender === 'woman') && selected.gender !== nextGender) setRoleName(''); }}>{GENDERS.filter(option => option.value !== 'nonbinary' || gender === 'nonbinary').map(option => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label><label className="gm-field">{t("Character reservation")}<select value={roleName} onChange={event => setRoleName(event.target.value)}><option value="">{t("Assign automatically")}</option>{CHARACTERS.filter(character => gender !== 'man' && gender !== 'woman' || character.gender === gender).map(character => <option key={character.id} value={character.name} disabled={room.players.some(player => player.id !== managed.id && player.roleName === character.name)}>{character.name}</option>)}</select></label><p>{t("Each character is unique. A man or woman preference is always respected; Either can fill either available seat. The culprit is dealt privately when you start.")}</p><button className="gm-button gm-primary gm-full-width" onClick={() => void savePlayer()}>{busy === 'player' ? t("Saving…") : t("Save character preference")}<Check size={18} /></button><button className="gm-inline-button gm-danger-text gm-remove" onClick={() => open('kick')}><Trash2 size={16} />{t("Remove player")}</button></fieldset></div>}
      {panel === 'kick' && managed && <div className="gm-form"><p>{t("{name} will lose their seat. They can join again while the room is open.", { name: managed.name })}</p><button className="gm-button gm-danger gm-full-width" disabled={disabled || room.phase !== 'lobby'} onClick={() => void act({ type: 'kick', playerId: managed.id }, true)}>{busy === 'kick' ? t("Removing…") : t("Yes, remove player")}<Trash2 size={17} /></button><button className="gm-button gm-secondary gm-full-width" disabled={!!busy} onClick={() => open('player')}>{t("Keep this player")}</button></div>}
      {panel === 'advance' && <div className="gm-form"><p>{room.phase === 'roles' ? t(missingCount === 1 ? "{count} player has not marked their role ready. They can still read it during the investigation." : "{count} players have not marked their role ready. They can still read it during the investigation.", { count: missingCount }) : t(missingCount === 1 ? "{count} player has not voted. Continuing closes voting and reveals the result using only the votes already received." : "{count} players have not voted. Continuing closes voting and reveals the result using only the votes already received.", { count: missingCount })}</p><button className="gm-button gm-primary gm-full-width" disabled={disabled || room.timer.isPaused || (room.phase !== 'roles' && room.phase !== 'voting')} onClick={() => void act({ type: 'advance' }, true)}>{busy === 'advance' ? t("Continuing…") : room.phase === 'voting' ? t("Close voting and reveal") : t("Begin investigation anyway")}<ArrowRight size={18} /></button><button className="gm-button gm-secondary gm-full-width" disabled={!!busy} onClick={() => setPanel(null)}>{t("Wait for everyone")}</button></div>}
      {panel === 'reset' && <div className="gm-form"><p>{t("Everyone keeps their seat. Characters, clues, readiness and votes will be cleared, and the room will reopen.")}</p><p>{t("This mystery cannot be restored after resetting.")}</p><button className="gm-button gm-primary gm-full-width" disabled={disabled} onClick={() => void act({ type: 'reset' }, true)}>{busy === 'reset' ? t("Resetting…") : t("Reset and keep the table")}<RotateCcw size={17} /></button><button className="gm-button gm-secondary gm-full-width" disabled={!!busy} onClick={() => setPanel(null)}>{t("Keep this mystery")}</button></div>}
    </Modal>}
  </div>;
}
