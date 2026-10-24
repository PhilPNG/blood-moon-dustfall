import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { gameStepIdentity } from '../../shared/game-step';
import { ArrowRight, Check, Copy, Eye, EyeOff, KeyRound, ShieldCheck, Users, X } from 'lucide-react';
import type { RoomView, Session, SessionKind } from '../../shared/types';
import { forgetSession, getSession, recoverSession, request, saveSession, savedGames } from '../client';
import { LanguageMenu, useLanguage } from '../i18n';

function useSessionChanges() {
  const [, refresh] = useState(0);
  useEffect(() => {
    const update = () => refresh(value => value + 1);
    window.addEventListener('alibi:sessions-changed', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('alibi:sessions-changed', update); window.removeEventListener('storage', update); };
  }, []);
}

function useRoomNow(room: RoomView) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 1_000);
    return () => window.clearInterval(timer);
  }, [room.serverNow]);
  return (room.serverNow ?? Date.now()) + elapsed;
}

function Notice({ children, error = false }: { children?: ReactNode; error?: boolean }) {
  return children ? <p className={`recovery-notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p> : null;
}

function Confirmation({ title, children, confirm, busy, confirmDisabled = false, onConfirm, onCancel, error, danger = false }: { title: string; children: ReactNode; confirm: string; busy: boolean; confirmDisabled?: boolean; onConfirm: () => void; onCancel: () => void; error?: string; danger?: boolean }) {
  const { t } = useLanguage();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLButtonElement>('[data-recovery-cancel]')?.focus();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog className="recovery-dialog" ref={dialog} aria-labelledby={id} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div className="recovery-dialog-heading"><h2 id={id}>{title}</h2><button className="recovery-icon-button" aria-label={t('Close dialog')} disabled={busy} onClick={onCancel}><X size={20}/></button></div>
    <div id={`${id}-description`}>{children}</div><Notice error>{error}</Notice>
    <div className="recovery-actions"><button className="recovery-button secondary" data-recovery-cancel disabled={busy} onClick={onCancel}>{t('Cancel')}</button><button className={`recovery-button${danger ? ' danger' : ''}`} disabled={busy || confirmDisabled} onClick={onConfirm}>{busy ? t('One moment…') : confirm}</button></div>
  </dialog>;
}

export function SavedGames({ code, kind }: { code?: string; kind?: SessionKind }) {
  const { t } = useLanguage();
  useSessionChanges();
  const games = savedGames().filter(game => (!code || game.session.code === code.toUpperCase()) && (!kind || game.kind === kind));
  return <section className="recovery-card recovery-saved" aria-label={t('Your saved games')}>
    <div className="recovery-card-heading"><KeyRound size={20}/><h2>{t(games.length ? 'Your saved games' : 'Returning to Dustfall?')}</h2></div>
    {games.length > 0 && <ul className="recovery-saved-list">{games.map(game => <li key={`${game.kind}:${game.session.code}`}><a className="recovery-saved-game" href={`/${game.kind === 'player' ? 'play' : 'master'}/${game.session.code}`}>
      <span className="recovery-saved-role">{game.kind === 'master' ? <ShieldCheck size={17}/> : <Users size={17}/>} {t(game.kind === 'master' ? 'Game master' : 'Player')} <b>{game.session.code}</b></span>
      <strong>{t('Return as {name}', { name: game.session.name ?? t(game.kind === 'master' ? 'Game master' : 'Player') })}</strong>
      {game.kind === 'player' && game.session.characterName && <span>{game.session.characterName}</span>}<ArrowRight className="recovery-saved-arrow" size={19}/>
    </a></li>)}</ul>}
    <a className="recovery-text-link" href={code ? `/recover/${code.toUpperCase()}` : '/recover'}>{t('Using another phone? Recover your access')}<ArrowRight size={17}/></a>
  </section>;
}

export function RecoverSessionForm({ initialCode = '', initialKind = 'player', onRecovered }: { initialCode?: string; initialKind?: SessionKind; onRecovered: (kind: SessionKind, session: Session) => void }) {
  const { t, language } = useLanguage();
  const id = useId();
  const [code, setCode] = useState(initialCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
  const [kind, setKind] = useState<SessionKind>(initialKind);
  const [secret, setSecret] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  const [error, setError] = useState('');
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { setCode(initialCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)); }, [initialCode]);
  useEffect(() => { setKind(initialKind); }, [initialKind]);
  useEffect(() => { setError(''); }, [language]);
  async function recover(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const normalized = secret.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z]{4}$/.test(code)) { setError(t('Enter a four-letter room code.')); return; }
    if (!/^[A-Z0-9]{12}$/.test(normalized)) { setError(t('Enter your twelve-character private recovery code.')); return; }
    pending.current = true; setBusy(true); setError('');
    try { const session = await recoverSession(code, kind, normalized); if (active.current) onRecovered(kind, session); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('Couldn’t recover your access. Check the room and private code.')); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="recovery-page" lang={language}><header className="recovery-page-header"><a className="recovery-brand" href="/">ALIBI<span>★</span></a><LanguageMenu/></header><main className="recovery-card recovery-form-card">
    <span className="recovery-kicker"><KeyRound size={17}/> {t('YOUR PRIVATE WAY BACK')}</span><h1>{t('Return to your mystery.')}</h1><p>{t('Use the private recovery code from your player or game master phone. Your name and room code alone cannot restore access.')}</p>
    <form className="recovery-form" onSubmit={recover}><fieldset disabled={busy}>
      <label htmlFor={`${id}-room`}>{t('Room code')}<input id={`${id}-room`} value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="DUST" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={4} pattern="[A-Z]{4}" required/></label>
      <label htmlFor={`${id}-kind`}>{t('Recover access as')}<select id={`${id}-kind`} value={kind} onChange={event => setKind(event.target.value as SessionKind)}><option value="player">{t('Player')}</option><option value="master">{t('Game master')}</option></select></label>
      <label htmlFor={`${id}-code`}>{t('Private recovery code')}<input id={`${id}-code`} type={visible ? 'text' : 'password'} value={secret} onChange={event => setSecret(event.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 24))} placeholder="XXXX XXXX XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24} aria-describedby={`${id}-hint`} required/></label>
      <button className="recovery-text-button" type="button" aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>} {t(visible ? 'Hide recovery code' : 'Reveal recovery code')}</button>
      <p className="recovery-help" id={`${id}-hint`}>{t('Previous devices lose access. Your character, clues and submitted actions stay saved.')}</p>
      <Notice error>{error && t(error)}</Notice><button className="recovery-button" type="submit">{t(busy ? 'Restoring your access…' : 'Recover my access')}<ArrowRight size={18}/></button>
    </fieldset></form><p className="recovery-help">{t('No saved browser or private code? Ask the game master for help. A new player can join only while the lobby is open.')}</p><a className="recovery-text-link" href={code.length === 4 ? `/join/${code}` : '/join'}>{t('Back to join')}<ArrowRight size={17}/></a>
    <p className="recovery-help">{t('If no saved browser, private code or eligible player remains, start a new room.')}</p><a className="recovery-text-link" href="/host">{t('Create a new room')}<ArrowRight size={17}/></a>
  </main></div>;
}

/** Public material only: never derive authority or links from the GM identity. */
export function GameMasterStatus({ room }: { room: RoomView }) {
  const { t } = useLanguage();
  if (!room.gameMaster) return null;
  return <aside className={`recovery-gm-status${room.gameMaster.connected ? '' : ' is-away'}`} aria-label={t('Game master status')}><ShieldCheck size={17}/><span><strong>{room.gameMaster.name}</strong><span>{t('Game master')} · {t(room.gameMaster.connected ? 'Connected' : 'Reconnecting')}</span>{!room.gameMaster.connected && <small>{t('The room keeps running. The game master can return on their saved phone.')}</small>}</span><i aria-hidden="true"/></aside>;
}

function SessionSwitchLinks({ code, current }: { code: string; current: SessionKind }) {
  const { t } = useLanguage();
  useSessionChanges();
  if (!getSession('player', code) || !getSession('master', code)) return null;
  return <nav className="recovery-switch" aria-label={t('Your room roles')}><a className="recovery-text-link" aria-current={current === 'player' ? 'page' : undefined} href={`/play/${code}`}><Users size={17}/>{t('Return to my character')}</a><a className="recovery-text-link" aria-current={current === 'master' ? 'page' : undefined} href={`/master/${code}`}><ShieldCheck size={17}/>{t('Open game master controls')}</a></nav>;
}

/** A slow generation response must never restore an older code or cached profile. */
export function saveRecoveryCode(kind: SessionKind, original: Session, refreshed: Session): 'saved' | 'memory' | 'stale' {
  const latest = getSession(kind, original.code);
  if (!latest || latest.token !== original.token || refreshed.code !== original.code || refreshed.token !== original.token ||
    (latest.recoveryRevision ?? 0) > (refreshed.recoveryRevision ?? 0)) return 'stale';
  const next = { ...refreshed, ...latest, recoveryCode: refreshed.recoveryCode, recoveryRevision: refreshed.recoveryRevision };
  return saveSession(kind, next) ? 'saved' : 'memory';
}

function PrivateRecoveryCode({ room, kind, connected }: { room: RoomView; kind: SessionKind; connected: boolean }) {
  const { t, language } = useLanguage();
  useSessionChanges();
  const session = getSession(kind, room.code);
  const [visible, setVisible] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setVisible(false); setError(''); setNotice(''); }, [room.code, session?.token]);
  useEffect(() => { setVisible(false); }, [session?.recoveryCode]);
  useEffect(() => { setError(''); setNotice(''); }, [language]);
  useEffect(() => {
    const hide = () => { if (document.hidden) setVisible(false); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  if (!session) return null;
  async function generate() {
    if (!session || !connected || pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const current = await request<Session>('room:recovery', { code: room.code, token: session.token });
      const saved = saveRecoveryCode(kind, session, current);
      if (saved === 'stale') return;
      setRegenerating(false); setVisible(false);
      setNotice(t(saved === 'saved' ? 'New recovery code created. Reveal it and keep it somewhere private.' : 'This browser cannot save access after this visit. Reveal and keep your recovery code before closing it.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Couldn’t create a recovery code. Try again.')); }
    finally { pending.current = false; setBusy(false); }
  }
  async function copy() {
    if (!session?.recoveryCode) return;
    try { await navigator.clipboard.writeText(session.recoveryCode); setNotice(t('Recovery code copied. Keep it private.')); }
    catch { setNotice(t('Copy is unavailable. Select the revealed code and copy it.')); }
  }
  return <section className="recovery-private-code" aria-label={t('Private recovery code')}><h3><KeyRound size={17}/>{t('Private recovery code')}</h3><p>{t('Keep this code somewhere safe before changing phones. Anyone with it can replace your access.')}</p>
    {session.recoveryCode ? <><button className="recovery-button secondary" type="button" aria-expanded={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>} {t(visible ? 'Hide recovery code' : 'Reveal recovery code')}</button>{visible && <div className="recovery-code-reveal"><output className="recovery-secret" aria-label={t('Your private recovery code')}>{session.recoveryCode.match(/.{1,4}/g)?.join(' ')}</output><button className="recovery-button secondary" type="button" onClick={() => void copy()}><Copy size={17}/>{t('Copy recovery code')}</button></div>}<button className="recovery-text-button" disabled={!connected || busy} onClick={() => { setError(''); setRegenerating(true); }}>{t('Create a new code')}</button></> : <button className="recovery-button secondary" disabled={!connected || busy} onClick={() => void generate()}><KeyRound size={17}/>{t(busy ? 'One moment…' : 'Create recovery code')}</button>}
    <a className="recovery-text-link" href={`/recover/${room.code}`}>{t('Recover on another phone')}<ArrowRight size={17}/></a><Notice error>{error && t(error)}</Notice><Notice>{notice}</Notice>
    {regenerating && <Confirmation title={t('Replace your recovery code?')} confirm={t('Create a new code')} busy={busy} onCancel={() => setRegenerating(false)} onConfirm={() => void generate()} error={error && t(error)}><p>{t('Your previous code will stop working. Your current phone and progress stay as they are.')}</p></Confirmation>}
  </section>;
}

export function PlayerRecovery({ room, connected, onMasterSession, onReleased }: { room: RoomView; connected: boolean; onMasterSession: (session: Session) => void; onReleased: () => void }) {
  const { t, language } = useLanguage();
  const stepIdentity = gameStepIdentity(room);
  useSessionChanges();
  const now = useRoomNow(room);
  const session = getSession('player', room.code);
  const [confirm, setConfirm] = useState<'accept' | 'takeover' | 'release' | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  const [error, setError] = useState('');
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { setError(''); }, [language]);
  useEffect(() => { setConfirm(null); setError(''); }, [room.code, stepIdentity, room.me?.playerId, session?.token]);
  if (!room.me || !session || session.playerId !== room.me.playerId) return null;
  const gm = room.gameMaster;
  const offered = gm?.handoff?.playerId === room.me.playerId && gm.handoff.expiresAt > now;
  const takeover = !gm?.connected && gm?.eligiblePlayerId === room.me.playerId && gm.takeoverAt !== undefined;
  const wait = Math.max(0, Math.ceil(((gm?.takeoverAt ?? now) - now) / 1_000));
  const eligible = confirm === 'accept' ? offered : confirm === 'takeover' ? takeover && wait === 0 : confirm === 'release' && room.phase === 'lobby';
  async function perform() {
    if (!connected || !session || !confirm || !eligible || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (confirm === 'release') {
        await request('room:leave', { code: room.code, token: session.token, release: true });
        if (getSession('player', room.code)?.token === session.token) {
          forgetSession('player', room.code); if (active.current) onReleased();
        }
      } else {
        const master = await request<Session>(confirm === 'accept' ? 'room:gm-accept' : 'room:gm-takeover', { code: room.code, token: session.token });
        if (getSession('player', room.code)?.token !== session.token) return;
        saveSession('master', master);
        const currentMaster = getSession('master', room.code);
        if (active.current && currentMaster) onMasterSession(currentMaster);
      }
      setConfirm(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Couldn’t update your access. Try again.')); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="recovery-card recovery-player" aria-label={t('Your seat and recovery')}>
    <div className="recovery-card-heading"><KeyRound size={20}/><h2>{t('Your seat and recovery')}</h2></div><p>{t('Stepping away keeps your character, clues and submitted actions saved. Return using this browser or your private code.')}</p><SessionSwitchLinks code={room.code} current="player"/>
    {offered ? <div className="recovery-transfer"><h3>{t('You’re invited to run the show.')}</h3><p>{t('{name} offered you the game master controls. You keep your player character.', { name: gm!.name })}</p><button className="recovery-button" disabled={!connected || busy} onClick={() => { setError(''); setConfirm('accept'); }}>{t('Accept game master role')}<ShieldCheck size={18}/></button></div> : takeover && <div className="recovery-transfer"><h3>{t('The table needs a game master.')}</h3><p>{wait > 0 ? t('If the game master stays disconnected, you can take over in {seconds}s.', { seconds: wait }) : t('Your game master has been away for a minute. You can take over and keep the mystery moving.')}</p><button className="recovery-button" disabled={!connected || busy || wait > 0} onClick={() => { setError(''); setConfirm('takeover'); }}>{t('Take over as game master')}<ShieldCheck size={18}/></button></div>}
    <PrivateRecoveryCode room={room} kind="player" connected={connected}/><Notice error>{!confirm && error && t(error)}</Notice>
    {room.phase === 'lobby' && <div className="recovery-release"><p>{t('Leaving for the evening? Release your lobby seat so someone else can join.')}</p><button className="recovery-text-button danger" disabled={!connected || busy} onClick={() => { setError(''); setConfirm('release'); }}>{t('Release lobby seat')}</button></div>}
    {confirm && <Confirmation title={t(confirm === 'release' ? 'Give up your lobby seat?' : 'Become the game master?')} confirm={t(confirm === 'release' ? 'Yes, release my seat' : 'Yes, take the controls')} danger={confirm === 'release'} busy={busy} confirmDisabled={!connected || !eligible} onCancel={() => setConfirm(null)} onConfirm={() => void perform()} error={error && t(error)}><p>{t(confirm === 'release' ? 'Your player identity and recovery code will be removed. You can join again while the lobby is open.' : 'This phone gains game master controls. The previous controller loses access. Your player character and progress stay saved.')}</p>{!eligible && <Notice>{t('This option has changed. Close this window and check the latest room status.')}</Notice>}</Confirmation>}
  </section>;
}

export function MasterRecovery({ room, connected }: { room: RoomView; connected: boolean }) {
  const { t, language } = useLanguage();
  useSessionChanges();
  const now = useRoomNow(room);
  const id = useId();
  const session = getSession('master', room.code);
  const [name, setName] = useState(room.gameMaster?.name ?? session?.name ?? 'Game master');
  const [backup, setBackup] = useState(room.gameMaster?.backupPlayerId ?? '');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setName(room.gameMaster?.name ?? session?.name ?? 'Game master'); setBackup(room.gameMaster?.backupPlayerId ?? ''); }, [room.code, room.gameMaster?.name, room.gameMaster?.backupPlayerId, session?.name]);
  useEffect(() => { setError(''); setNotice(''); }, [language]);
  if (!room.isMaster || !session) return null;
  const candidates = room.players.filter(player => !player.isDemo);
  const offer = room.gameMaster?.handoff;
  const offeredPlayer = offer && offer.expiresAt > now ? room.players.find(player => player.id === offer.playerId) : undefined;
  async function mutate(event: 'room:gm-profile' | 'room:gm-offer', payload: Record<string, unknown>, message: string) {
    if (!connected || !session || pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const updated = await request<RoomView>(event, { code: room.code, token: session.token, ...payload });
      const latest = getSession('master', room.code);
      if (event === 'room:gm-profile' && updated.gameMaster && latest?.token === session.token) saveSession('master', { ...latest, name: updated.gameMaster.name });
      setNotice(message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Couldn’t update your access. Try again.')); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="recovery-card recovery-master" aria-label={t('Game master and recovery')}>
    <div className="recovery-card-heading"><ShieldCheck size={20}/><h2>{t('Game master and recovery')}</h2></div><SessionSwitchLinks code={room.code} current="master"/>
    <form className="recovery-form" onSubmit={event => { event.preventDefault(); if (name.trim()) void mutate('room:gm-profile', { name: name.trim(), backupPlayerId: backup || null }, t('Game master details saved.')); }}><fieldset disabled={!connected || busy}>
      <label htmlFor={`${id}-name`}>{t('Game master name')}<input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} maxLength={24} autoComplete="nickname" required/></label>
      <label htmlFor={`${id}-backup`}>{t('Backup game master')}<select id={`${id}-backup`} value={backup} onChange={event => setBackup(event.target.value)}><option value="">{t('Automatic · first connected player')}</option>{candidates.map(player => <option key={player.id} value={player.id}>{player.name}{player.connected ? '' : ` · ${t('Away')}`}</option>)}</select></label>
      <p className="recovery-help">{t('After one minute away, your backup can choose to take over. Automatic uses the first connected real player. A chosen backup must be connected.')}</p><button className="recovery-button secondary" type="submit"><Check size={17}/>{t(busy ? 'One moment…' : 'Save game master details')}</button>
    </fieldset></form>
    <div className="recovery-transfer"><h3>{t('Hand over the controls')}</h3><p>{t('Choose a player to invite. They confirm on their own phone, and you keep your character if you have one.')}</p>
      {offeredPlayer && <><Notice>{t('Offered to {name} · {seconds}s left', { name: offeredPlayer.name, seconds: Math.max(0, Math.ceil((offer!.expiresAt - now) / 1_000)) })}</Notice><button className="recovery-text-button" disabled={!connected || busy} onClick={() => void mutate('room:gm-offer', {}, t('Game master invitation cancelled.'))}>{t('Cancel invitation')}</button></>}
      <label className="recovery-field" htmlFor={`${id}-target`}>{t('Invite a player')}<select id={`${id}-target`} value={target} disabled={!connected || busy || candidates.length === 0} onChange={event => setTarget(event.target.value)}><option value="">{t('Choose a player')}</option>{candidates.map(player => <option key={player.id} value={player.id}>{player.name}{player.connected ? '' : ` · ${t('Away')}`}</option>)}</select></label>
      <button className="recovery-button secondary" disabled={!connected || busy || !candidates.some(player => player.id === target)} onClick={() => void mutate('room:gm-offer', { playerId: target }, t('Game master invitation sent. It expires in two minutes.'))}>{t('Offer game master role')}<ArrowRight size={17}/></button>
      {candidates.length === 0 && <p className="recovery-help">{t('A real player must join before you can hand over the controls.')}</p>}
    </div><Notice error>{error && t(error)}</Notice><Notice>{notice}</Notice><PrivateRecoveryCode room={room} kind="master" connected={connected}/>
    <p className="recovery-help">{t('Closing this phone keeps the room running. Return in this browser, use your private code, or let your eligible backup take over after one minute.')}</p>
  </section>;
}
