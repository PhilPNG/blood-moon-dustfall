import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Copy, Fingerprint, Flag, LayoutDashboard, ListOrdered, LockKeyhole, Maximize2, MoreHorizontal, Pause, Play, Plus, Radio, RotateCcw, ScanLine, Settings2, ShieldCheck, Smartphone, Trash2, UnlockKeyhole, Users, Wifi, WifiOff, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Action, Gender, PlayerView, RoomView, Settings } from '../../shared/types';
import { GENDERS, PHASES, ROLE_NAMES } from '../../shared/types';
import { Modal } from './Modal';
import { Clock } from './Clock';

type HostProps = {
  room?: RoomView;
  connected: boolean;
  command: (action: Action) => Promise<void>;
  joinOrigin: string;
  create: (demo?: boolean) => Promise<void>;
  creating: boolean;
  error: string;
  onJoin: () => void;
  onHome: () => void;
  homeExtra?: ReactNode;
};
type Panel = 'guide' | 'flow' | 'settings' | 'player' | 'reset' | 'advance' | null;

const steps = [
  { icon: Users, title: 'Gather your suspects', text: 'Create a room and share the code. Everyone joins on their own phone. No downloads, no accounts.' },
  { icon: Fingerprint, title: 'Give everyone a secret', text: 'Private characters. Hidden motives. One culprit. Your players see only what they should.' },
  { icon: ScanLine, title: 'Let the mystery unfold', text: 'Guide each round, reveal the evidence, and watch the accusations fly. You set the pace.' },
];

export function Host({ room, connected, command, joinOrigin, create, creating, error, onJoin, onHome, homeExtra }: HostProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [managed, setManaged] = useState<PlayerView | null>(null);
  const [gender, setGender] = useState<Gender>('any');
  const [roleName, setRoleName] = useState('');
  const [kickConfirm, setKickConfirm] = useState(false);
  const [settings, setSettings] = useState<Settings>({ rounds: 3, roundSeconds: 180, maxPlayers: 12 });
  const phaseIndex = PHASES.findIndex(phase => phase.id === room?.phase);
  const disabled = !connected || !!busy;
  const joinUrl = room ? `${joinOrigin.replace(/\/$/, '')}/join/${room.code}` : '';
  const publicClues = room?.clues.filter(clue => clue.published) ?? [];
  const readyCount = room?.players.filter(player => player.ready).length ?? 0;
  const canAdvance = room?.phase === 'roles' ? readyCount === room.players.length : room?.phase === 'voting' ? room.votesCount === room.players.length : true;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => { setLocalError(''); setPanel(null); }, [room?.code]);

  function open(next: Panel) {
    setLocalError('');
    if (next === 'settings' && room) setSettings({ ...room.settings });
    setPanel(next);
  }
  async function act(action: Action, key = action.type, close = false) {
    if (disabled) return;
    setBusy(key); setLocalError('');
    try { await command(action); if (close) setPanel(null); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(null); }
  }
  async function copy(value: string, key: string) {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(value);
      else {
        const field = document.createElement('textarea');
        field.value = value; field.style.position = 'fixed'; field.style.opacity = '0'; document.body.appendChild(field); field.select();
        const success = document.execCommand('copy'); field.remove();
        if (!success) throw new Error('Your browser couldn’t copy this. Select and copy the room code instead.');
      }
      setCopied(key);
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Your browser couldn’t copy this. Select the code to copy it.'); }
  }
  function manage(player: PlayerView) {
    setManaged(player); setGender(player.gender); setRoleName(player.roleName ?? ''); setKickConfirm(false); open('player');
  }
  async function savePlayer() {
    if (!managed || disabled) return;
    setBusy('save-player'); setLocalError('');
    try {
      if (managed.gender !== gender) await command({ type: 'set-gender', playerId: managed.id, gender });
      if ((managed.roleName ?? '') !== roleName) await command({ type: 'set-role', playerId: managed.id, roleName });
      setPanel(null);
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Couldn’t update this player.'); }
    finally { setBusy(null); }
  }

  const nextMove = !room ? null : room.phase === 'lobby'
    ? { title: 'The table is yours.', text: room.players.length < 4 ? `Gather at least 4 players to begin. ${4 - room.players.length} more ${4 - room.players.length === 1 ? 'suspect' : 'suspects'} to go.` : 'The suspects are here. Assign private characters and let the evening begin.', button: 'Start the mystery', action: { type: 'start' } as Action, locked: room.players.length < 4 }
    : room.phase === 'roles'
      ? { title: 'Secrets, delivered.', text: `${readyCount} of ${room.players.length} players have read their character. Wait for every player to acknowledge their role.`, button: 'Begin investigation', action: { type: 'advance' } as Action, locked: !canAdvance || room.timer.isPaused }
      : room.phase === 'investigation'
        ? { title: room.timer.isPaused ? 'A moment of suspense.' : 'Follow the evidence.', text: room.timer.isPaused ? 'The timer and player actions are paused. Resume when your table is ready.' : room.round < room.settings.rounds ? `Round ${room.round} of ${room.settings.rounds}. Let the discussion unfold, then move to the next round.` : 'The final evidence is in play. When the table is ready, open the accusations.', button: room.round < room.settings.rounds ? 'Next investigation round' : 'Open the accusations', action: { type: 'advance' } as Action, locked: room.timer.isPaused }
        : room.phase === 'voting'
          ? { title: 'Time to point fingers.', text: `${room.votesCount} of ${room.players.length} private accusations filed. Wait for every vote before revealing the culprit.`, button: 'Reveal the truth', action: { type: 'advance' } as Action, locked: !canAdvance || room.timer.isPaused }
          : { title: 'One more mystery?', text: 'Keep your table together and deal a fresh set of secrets. All characters, evidence and votes will be cleared.', button: 'Play another round', action: { type: 'reset' } as Action, locked: false };

  function flowList() {
    return <ol className="flow-list">{PHASES.map((phase, index) => <li key={phase.id} className={index === phaseIndex ? 'current' : index < phaseIndex ? 'done' : ''}><span className="flow-number">{index < phaseIndex ? <Check size={12} /> : String(index + 1).padStart(2, '0')}</span><div><strong>{phase.label}</strong><span>{phase.description}</span></div>{index === phaseIndex && <span className="flow-current-dot" />}</li>)}</ol>;
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="wordmark" onClick={onHome} aria-label="ALIBI home">ALIBI<span>®</span></button>
      <div className="sidebar-caption">GOOD FRIENDS. BAD ALIBIS.</div>
      <div className="nav-label">YOUR EVENING</div>
      <nav aria-label="Game master navigation">
        <button className={`nav-item ${panel === null ? 'active' : ''}`} onClick={() => setPanel(null)}><LayoutDashboard size={17} /> Overview<span className="nav-dot" /></button>
        <button className={`nav-item ${panel === 'flow' ? 'active' : ''}`} onClick={() => open('flow')}><ListOrdered size={18} /> Game flow</button>
        <button className={`nav-item ${panel === 'settings' ? 'active' : ''}`} disabled={!room || room.phase !== 'lobby'} onClick={() => open('settings')}><Settings2 size={17} /> Room settings</button>
      </nav>
      <div className="sidebar-bottom"><button className={`nav-item ${panel === 'guide' ? 'active' : ''}`} onClick={() => open('guide')}><BookOpen size={17} /> The host’s handbook<ArrowUpRight size={13} /></button><div className="sidebar-note"><Fingerprint size={27} strokeWidth={1} /><p>A little mystery.<br />A very good night.</p></div><div className="sidebar-version"><span>ALIBI / ONLINE EDITION</span><span>V.01</span></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb">Your evening<ChevronRight size={13} /><span>{room ? 'Control room' : 'Overview'}</span></div><div className="topbar-right"><span className={`system-state ${connected ? '' : 'offline'}`}>{connected ? <><span /> ALL SYSTEMS SUSPICIOUS</> : <><WifiOff size={12} /> RECONNECTING</>}</span><span className="master-avatar" aria-label="Game master">GM</span></div></header>
      <main className="main-content">
        <div className="page-heading"><div><span className="eyebrow">{room ? `CASE ${room.code} / THE CONTROL ROOM` : 'THE NIGHT IS WHAT YOU MAKE IT'}</span><h1>{room ? 'Let the suspicion begin.' : 'Your next great night starts here.'}</h1><p>{room ? 'You set the scene. They keep the secrets.' : 'Private controls on your phone. A public display on your computer or TV.'}</p></div>{room && <button className="button secondary small" disabled={disabled || room.phase !== 'lobby'} onClick={() => open('settings')}><Settings2 size={15} /> Room settings</button>}</div>
        {(error || localError) && !panel && <div className="notice error" role="alert"><CircleHelp size={17} /><span>{localError || error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setLocalError('')}><X size={16} /></button></div>}
        {!connected && <div className="notice" role="status"><WifiOff size={17} /> Reconnecting. Room controls will return in a moment.</div>}
        {!room ? <>
          <section className="welcome-hero">
            <div className="welcome-copy"><span className="badge"><span /> AN EVENING WITH A TWIST</span><h2>Someone’s hiding<br /><em>something.</em><br />Get everyone in.</h2><p>Bring your favorite people together for a murder mystery that lives on their phones. Private game master controls on your phone. A public display on your computer or TV.</p><div className="hero-actions"><button className="button primary" disabled={creating || !connected} onClick={() => create(false)}>{creating ? 'Preparing your room…' : 'Create a room'}<ArrowUpRight size={17} /></button><button className="button ghost" disabled={creating || !connected} onClick={() => create(true)}>Take a test run<ArrowRight size={16} /></button></div><a className="home-phone-entry text-button" href="/host">Host on this phone<Smartphone size={16}/></a><div className="hero-detail"><Users size={13} /><span>4–12 players</span><span>·</span><span>One unforgettable night</span></div></div>
            <div className="case-art" aria-hidden="true"><div className="file-back"><span>CONFIDENTIAL</span></div><div className="evidence-photo"><div className="photo-top"><span>PERSON OF INTEREST</span><span>No 01</span></div><div className="silhouette"><div className="silhouette-head" /><div className="silhouette-body" /><Fingerprint size={95} strokeWidth={.7} /></div><div className="photo-bottom">EVERYONE’S A SUSPECT.</div></div><div className="art-sticker"><Fingerprint size={24} strokeWidth={1} /><span>TRUST<br />NO ONE</span></div><div className="evidence-tag"><span>CASE FILE</span><strong>THE NIGHT<br />IS YOUNG</strong><div className="barcode" /><small>ALIBI / 000001</small></div></div>
          </section>
          {homeExtra}
          <div className="section-label"><span>A GOOD MYSTERY. ZERO FUSS.</span><span>HERE’S HOW IT GOES <ArrowDownRight size={14} /></span></div>
          <div className="onboarding-grid">{steps.map((step, index) => <article className="onboard-card" key={step.title}><div className="onboard-top"><span>0{index + 1}</span><step.icon size={23} strokeWidth={1.25} /></div><h3>{step.title}</h3><p>{step.text}</p></article>)}</div>
          <div className="landing-bottom"><span>Already have a room code?</span><button className="text-button" onClick={onJoin}>Join the table<ArrowUpRight size={14} /></button><span className="landing-footnote"><LockKeyhole size={12} /> No accounts. No downloads. Just your people.</span></div>
        </> : <>
          <div className="dashboard-grid"><div className="dashboard-main">
            <section className="panel room-ticket"><div className="ticket-copy"><div className="eyebrow">{room.phase === 'lobby' && !room.isLocked ? 'THE INVITATION IS OPEN' : 'THE TABLE IS SET'}</div><h2>Every mystery needs suspects.</h2><p>{room.phase === 'lobby' ? 'Share the code or let your players scan in. Their secrets stay on their own phones.' : 'Your players’ seats are saved. Keep the room open for the whole evening.'}</p><div className="room-code"><span>{room.code}</span><button className="icon-button" onClick={() => copy(room.code, 'code')} aria-label="Copy room code">{copied === 'code' ? <Check size={18} /> : <Copy size={18} />}</button></div><button className="text-button" onClick={() => copy(joinUrl, 'invite')}>{copied === 'invite' ? <><Check size={13} /> Invite link copied</> : <><Copy size={13} /> Copy invite link</>}</button></div><div className="ticket-qr"><QRCodeSVG value={joinUrl} size={112} level="M" bgColor="#f3f1e8" fgColor="#252a1e" title={`Join ALIBI room ${room.code}`} /><span>SCAN. JOIN. SUSPECT.</span></div><div className="ticket-note"><Wifi size={12} /><span>Everyone can join with an internet connection.</span><span className="ticket-room-state">{room.phase === 'lobby' && !room.isLocked ? <><span /> ROOM OPEN</> : <><LockKeyhole size={11} /> ROOM LOCKED</>}</span></div></section>
            <section className="panel roster-panel"><div className="panel-heading"><div><div className="heading-with-count"><h2>The usual suspects</h2><span className="count-pill">{room.players.length}<span> / {room.settings.maxPlayers}</span></span></div><p>{room.phase === 'lobby' ? 'Your cast of characters. Some more suspicious than others.' : room.phase === 'roles' ? 'Their characters are private. Wait for everyone to read their role.' : 'Keep an eye on the table. The secrets stay on their phones.'}</p></div>{room.phase === 'lobby' && <button className="button ghost small" disabled={disabled} onClick={() => act({ type: 'lock', locked: !room.isLocked })}>{room.isLocked ? <UnlockKeyhole size={14} /> : <LockKeyhole size={14} />}{room.isLocked ? 'Unlock room' : 'Lock room'}</button>}</div>
              {room.players.length > 0 ? <div className="roster-list"><div className="roster-label"><span>PLAYER</span><span>{room.phase === 'lobby' ? 'CHARACTER PREFERENCE' : 'CHARACTER'}</span><span>STATUS</span><span /></div>{room.players.map((player, index) => <div className="roster-row" key={player.id}><div className="player-identity"><span className={`player-avatar tone-${index % 4}`}>{player.name.charAt(0).toUpperCase()}</span><div><strong>{player.name}</strong><span>Suspect {String(index + 1).padStart(2, '0')}</span></div></div><div className="player-character"><span>{room.phase === 'lobby' ? GENDERS.find(option => option.value === player.gender)?.label : player.roleName ?? 'Character assigned'}</span>{room.phase === 'lobby' && player.roleName && <small>{player.roleName}</small>}</div><div className={`player-status ${!player.connected ? 'away' : player.ready && room.phase === 'roles' ? 'ready' : ''}`}><span />{!player.connected ? 'Away' : room.phase === 'roles' ? player.ready ? 'Ready' : 'Reading' : 'Connected'}</div><button className="icon-button" aria-label={`Manage ${player.name}`} disabled={room.phase !== 'lobby' || disabled} onClick={() => manage(player)}><MoreHorizontal size={19} /></button></div>)}</div> : <div className="empty-roster"><Users size={32} strokeWidth={1} /><h3>The suspects are on their way.</h3><p>Share your room code to get the table together.</p><button className="button secondary small" onClick={() => copy(joinUrl, 'invite')}><Copy size={13} />{copied === 'invite' ? 'Copied!' : 'Copy invitation'}</button></div>}
              <div className="roster-footer"><span><ShieldCheck size={13} /> {room.phase === 'lobby' ? '4 players minimum. A little more suspicion is always welcome.' : 'Private roles and alignments stay on each player’s phone.'}</span>{room.phase === 'lobby' && <button className="text-button" disabled={disabled || room.settings.maxPlayers - room.players.length < 4} onClick={() => act({ type: 'demo-fill' })}><Plus size={13} /> Add 4 sample players</button>}</div>
            </section>
            {room.phase !== 'lobby' && room.phase !== 'results' && <section className="panel live-round"><div className="panel-heading"><div><span className="eyebrow">{room.phase === 'investigation' ? `INVESTIGATION / ROUND ${room.round}` : 'LIVE AT YOUR TABLE'}</span><h2>{PHASES[phaseIndex]?.label}</h2></div>{room.phase === 'investigation' && <Clock timer={room.timer} serverNow={room.serverNow} />}</div><div className="live-round-actions"><span>{room.timer.isPaused ? 'The game is paused. Player actions are on hold.' : room.phase === 'investigation' ? 'When the timer runs out, you decide when to continue.' : room.phase === 'roles' ? `${readyCount} of ${room.players.length} players ready` : `${room.votesCount} of ${room.players.length} votes received`}</span><button className="button secondary small" disabled={disabled} onClick={() => act({ type: room.timer.isPaused ? 'resume' : 'pause' })}>{room.timer.isPaused ? <Play size={13} /> : <Pause size={13} />}{room.timer.isPaused ? 'Resume game' : 'Pause game'}</button></div></section>}
            {(publicClues.length > 0 || room.phase === 'investigation' || room.phase === 'voting') && <section className="panel evidence-panel"><div className="panel-heading"><div><h2>On the record</h2><p>The evidence your players have chosen to share.</p></div><span className="badge">{publicClues.length} PUBLIC</span></div>{publicClues.length === 0 ? <div className="evidence-empty"><Radio size={23} /><p>No public evidence yet. The table is keeping its secrets.</p></div> : <div className="host-clue-grid">{publicClues.map(clue => <article className="host-clue" key={clue.id}><span className="eyebrow">ROUND {clue.round} / {clue.playerName}</span><h3>{clue.title}</h3><p>{clue.text}</p></article>)}</div>}</section>}
            {room.phase === 'results' && room.result && <section className="panel host-results"><span className="eyebrow">THE VERDICT IS IN</span><h2>{room.result.caught ? 'Caught, red-handed.' : 'A perfect getaway.'}</h2><p>The culprit was <strong>{room.players.find(player => player.id === room.result!.culpritId)?.name}</strong>. {room.result.caught ? 'The table’s accusation hit its mark.' : 'Ties and incorrect accusations let the culprit escape.'}</p><div className="result-tallies">{[...room.players].sort((a, b) => (room.result!.tallies[b.id] ?? 0) - (room.result!.tallies[a.id] ?? 0)).map(player => <div key={player.id}><span>{player.name}{player.id === room.result!.culpritId && <small>CULPRIT</small>}</span><strong>{room.result!.tallies[player.id] ?? 0} {(room.result!.tallies[player.id] ?? 0) === 1 ? 'vote' : 'votes'}</strong></div>)}</div></section>}
          </div><aside className="dashboard-rail">
            <section className="panel flow-panel"><div className="panel-heading"><h2>The game plan</h2><Flag size={16} /></div>{flowList()}<button className="flow-settings" disabled={room.phase !== 'lobby'} onClick={() => open('settings')}><Clock3 size={13} /><span>{room.settings.rounds} rounds <span>·</span> {room.settings.roundSeconds / 60} min each</span><Settings2 size={13} /></button></section>
            {nextMove && <section className="next-move"><span className="eyebrow">YOUR NEXT MOVE</span><h3>{nextMove.title}</h3><p>{nextMove.text}</p><button className="button primary full-width" disabled={disabled || nextMove.locked} onClick={() => room.phase === 'results' ? open('reset') : act(nextMove.action)}>{busy === nextMove.action.type ? 'One moment…' : nextMove.button}<ArrowRight size={15} /></button>{(room.phase === "roles" || room.phase === "voting") && !canAdvance && !room.timer.isPaused && <button className="text-button full-width early-advance" disabled={disabled} onClick={() => open("advance")}>Continue without everyone<ArrowRight size={13}/></button>}<span className="next-footnote">{room.phase === 'lobby' ? 'Roles are assigned automatically. Secrets stay secret.' : 'You control the pace. Nothing advances automatically.'}</span></section>}
            <a className="display-link" href={`/screen/${room.code}`} target="_blank" rel="noreferrer"><Maximize2 size={17} /><div><strong>Put it on the big screen</strong><span>Open the public room display</span></div><ArrowUpRight size={16} /></a>
            <p className="lan-note"><Wifi size={14} /><span>Your room stays online. Keep the private controls on your phone.</span></p>
            {room.phase !== 'lobby' && <button className="text-button reset-link" disabled={disabled} onClick={() => open('reset')}><RotateCcw size={13} /> Reset to lobby</button>}
          </aside></div>
        </>}
        <footer className="workspace-footer"><span>KEEP YOUR FRIENDS CLOSE. YOUR ALIBI CLOSER.</span><span>MADE FOR A GOOD NIGHT.</span></footer>
      </main>
    </div>
    {panel && <Modal title={panel === 'guide' ? 'The host’s handbook' : panel === 'flow' ? 'The shape of your evening' : panel === 'settings' ? 'Set the scene.' : panel === 'player' ? `Manage ${managed?.name ?? 'player'}` : panel === 'advance' ? 'Keep the evening moving?' : 'A fresh set of secrets?'} onClose={() => { if (!busy) setPanel(null); }}>
      {localError && <div className="notice error" role="alert">{localError}</div>}
      {panel === 'guide' && <div className="handbook-content"><p className="modal-intro">You’re the non-playing game master. Keep this screen private and open the public display on your main screen.</p><ol className="handbook-steps"><li><strong>Get everyone connected.</strong><p>Open the public display on your computer or TV. Run the night from your phone. Players join online from the QR code or invitation link. You need 4–12 players.</p></li><li><strong>Deal the secrets.</strong><p>Start the mystery to assign unique characters and exactly one hidden culprit. Players reveal their own private file and mark themselves ready.</p></li><li><strong>Follow the evidence.</strong><p>Each round gives every player a private clue. Players can publish it for the table. The timer is your cue; you always advance the game.</p></li><li><strong>Call the accusation.</strong><p>Each player makes one private, final vote. Reveal the result when everyone has voted. A tie lets the culprit escape.</p></li></ol><div className="notice"><CircleHelp size={17} /><span>This prototype uses mechanical placeholder characters and clues. Story content is ready for you to add later.</span></div><button className="button primary full-width" onClick={() => setPanel(null)}>Let’s get suspicious<ArrowRight size={16} /></button></div>}
      {panel === 'flow' && <div><p className="modal-intro">Five phases. You set the pace from your control room.</p>{flowList()}<p className="modal-intro">Pause whenever your table needs a moment. A timer reaching zero never advances the game on its own.</p><button className="button primary full-width" onClick={() => setPanel(null)}>Back to the evening<ArrowRight size={16} /></button></div>}
      {panel === 'settings' && room && <form className="modal-form" onSubmit={event => { event.preventDefault(); act({ type: 'settings', settings }, 'settings', true); }}><p className="modal-intro">A brisk mystery or a little more time for suspicion. Make it your night.</p><label className="field">Investigation rounds<select value={settings.rounds} onChange={event => setSettings({ ...settings, rounds: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map(number => <option value={number} key={number}>{number} {number === 1 ? 'round' : 'rounds'}</option>)}</select></label><label className="field">Time per round<select value={settings.roundSeconds} onChange={event => setSettings({ ...settings, roundSeconds: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, index) => index + 1).map(number => <option value={number * 60} key={number}>{number} {number === 1 ? 'minute' : 'minutes'}</option>)}</select></label><label className="field">Maximum players<input type="number" value={settings.maxPlayers} min={Math.max(4, room.players.length)} max={12} required onChange={event => setSettings({ ...settings, maxPlayers: Number(event.target.value) })} /></label><p className="field-help">Between 4 and 12 players. The game master doesn’t take a player seat.</p><button className="button primary full-width" type="submit" disabled={disabled}>{busy === 'settings' ? 'Saving…' : 'Save room settings'}<Check size={16} /></button></form>}
      {panel === 'player' && managed && room && <div className="modal-form"><p className="modal-intro">Character choices are role-playing preferences. They don’t infer anyone’s identity.</p><label className="field">Character gender<select value={gender} onChange={event => setGender(event.target.value as Gender)}>{GENDERS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label className="field">Character archetype<select value={roleName} onChange={event => setRoleName(event.target.value)}><option value="">Assign automatically</option>{ROLE_NAMES.map(name => <option value={name} key={name} disabled={room.players.some(player => player.id !== managed.id && player.roleName === name)}>{name}</option>)}</select></label><p className="field-help">Each archetype is unique. Culprit assignment stays random and private.</p><button className="button primary full-width" disabled={disabled} onClick={savePlayer}>{busy === 'save-player' ? 'Saving…' : 'Save character preference'}<Check size={16} /></button><div className="remove-player-zone">{kickConfirm ? <><p>Remove {managed.name} from this room? They’ll need to join again to return.</p><div className="modal-actions"><button className="button danger small" disabled={disabled} onClick={() => act({ type: 'kick', playerId: managed.id }, 'kick', true)}><Trash2 size={14} /> Yes, remove player</button><button className="button secondary small" disabled={disabled} onClick={() => setKickConfirm(false)}>Keep them</button></div></> : <button className="text-button danger-text" disabled={disabled} onClick={() => setKickConfirm(true)}><Trash2 size={13} /> Remove player from room</button>}</div></div>}
      {panel === 'advance' && room && <div className="modal-form"><p className="modal-intro">{room.phase === 'roles' ? 'Some players have not acknowledged their role. They can still read it during the investigation.' : 'Some players have not voted. Continuing will close voting and reveal the result using the accusations already filed.'}</p><button className="button primary full-width" disabled={disabled || room.timer.isPaused} onClick={() => act({type:'advance'}, 'advance', true)}>Continue now<ArrowRight size={16}/></button><button className="button secondary full-width" disabled={disabled} onClick={() => setPanel(null)}>Give them a moment</button></div>}
      {panel === 'reset' && <div className="modal-form"><p className="modal-intro">Everyone keeps their seat. Characters, clues, readiness, and votes will be cleared, and the room will reopen for joining.</p><p className="field-help">The current mystery can’t be restored after you reset.</p><button className="button primary full-width" disabled={disabled} onClick={() => act({ type: 'reset' }, 'reset', true)}>{busy === 'reset' ? 'Resetting…' : 'Reset and keep the table'}<RotateCcw size={16} /></button><button className="button secondary full-width" disabled={disabled} onClick={() => setPanel(null)}>Keep this mystery going</button></div>}
    </Modal>}
  </div>;
}
