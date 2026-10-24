import { useLanguage, LanguageMenu, LanguagePicker } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle, LockKeyhole, Monitor, Smartphone, Users, WifiOff } from 'lucide-react';
import { claimMasterSession, createPhoneRoom, getSession, getPairing, clearPairing, forgetSession, updateSessionFromView, prepareDisplayRoom, request, RpcError, saveSession } from './client';
import type { Action, PairingTicket, RoomView, Session, SessionKind } from '../shared/types';
import type { Language } from '../shared/locale';
import { ArcadeHome } from './components/ArcadeHome';
import { Master } from './components/Master';
import { Display } from './components/Display';
import { Join, Player } from './components/Player';
import { SavedGames, RecoverSessionForm } from './components/RoomRecovery';
import { closePresence } from './presence';
import { routeAnchor } from './route-anchor';
import { publicJoinOrigin } from './join-origin';
import { roomCommandPayload } from './room-command';
import { audienceRoom, isPublicRoomRoute, roomSubscribePayload } from './audience-routing';
import { WatchEntry } from './components/WatchEntry';
import { SpectatorPanel } from './components/SpectatorPanel';
import { watchCopy } from './watch-translations';
import { DeveloperStart, RehearsalControls, FilmLibrary } from './components/Developer';

const claimMemory = new Map<string, ClaimReceipt>();
type ClaimReceipt = { code: string; ticket: string; requestId: string };
function captureClaim(code: string): ClaimReceipt | undefined {
  const key = `alibi:claim:${code}`;
  let saved: ClaimReceipt | undefined = claimMemory.get(code);
  try { saved = JSON.parse(sessionStorage.getItem(key) || 'null') ?? saved; } catch { /* A new fragment can replace an unreadable receipt. */ }
  const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
  if (ticket) {
    const receipt = saved?.code === code && saved.ticket === ticket && saved.requestId ? saved : { code, ticket, requestId: crypto.randomUUID() };
    // Persist the retry receipt before removing the ticket from the visible URL.
    claimMemory.set(code, receipt);
    try { sessionStorage.setItem(key, JSON.stringify(receipt)); } catch { /* Keep the retry receipt for this visit. */ }
    history.replaceState({}, '', location.pathname + location.search);
    return receipt;
  }
  return saved?.code === code && saved.ticket && saved.requestId ? saved : undefined;
}

export default function App() {
  const { t, language, hasChosenLanguage } = useLanguage();
  const [path, setPath] = useState(location.pathname);
  const [room, setRoom] = useState<RoomView>();
  const [connected, setConnected] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [joinOrigin, setJoinOrigin] = useState(location.origin);
  const [creating, setCreating] = useState(false);
  const [claimRetry, setClaimRetry] = useState(0);
  const [, refreshSession] = useState(0);
  const [presenceGeneration, restartPresence] = useState(0);
  const activePath = useRef(path);
  activePath.current = path;
  const [kind, rawCode = ''] = path.split('/').filter(Boolean);
  const viewLanguage: Language = kind === 'screen' || kind === 'dev' ? 'en' : language;
  const activeViewLanguage = useRef(viewLanguage);
  activeViewLanguage.current = viewLanguage;
  const code = rawCode.toUpperCase();
  const validCode = /^[A-Z]{4}$/.test(code);
  const mode = kind === 'master' || kind === 'host' || kind === 'dev' ? 'master' : 'player';
  const publicRoute = isPublicRoomRoute(kind);
  const session = publicRoute ? undefined : getSession(mode, code);
  const isRoomRoute = ['master', 'screen', 'play', 'dev', 'watch'].includes(kind);

  const navigate = useCallback((next: string) => {
    const destination = new URL(next, location.origin);
    activePath.current = destination.pathname;
    history.pushState({}, '', destination.pathname + destination.search + destination.hash); setRoom(undefined); setError(''); setConnected(navigator.onLine); setPath(destination.pathname); refreshSession(value => value + 1); window.scrollTo(0, 0);
  }, []);
  const receive = useCallback((view: RoomView, route: string, responseLanguage: Language, expectedToken?: string) => {
    if (activePath.current !== route || activeViewLanguage.current !== responseLanguage) return;
    const [routeKind, routeCode] = route.split('/').filter(Boolean);
    const routeMode = routeKind === 'master' || routeKind === 'dev' ? 'master' : 'player';
    if (expectedToken && getSession(routeMode, routeCode?.toUpperCase())?.token !== expectedToken) return;
    const current = expectedToken && getSession(routeMode, routeCode?.toUpperCase());
    if (current) updateSessionFromView(routeMode, current, view);
    setRoom(previous => previous?.code === view.code && (previous.revision ?? -1) > (view.revision ?? -1) ? previous : view);
  }, []);

  useEffect(() => {
    // Keep current-visit credentials usable when browser storage is unavailable.
    const routeLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, location.origin);
      if (url.origin !== location.origin || !(url.pathname === '/' || /^\/(?:join|play|master|recover|host|dev|films|screen|watch|cast|party-kit)(?:\/|$)/.test(url.pathname))) return;
      if (url.pathname === location.pathname && url.hash) return;
      event.preventDefault(); navigate(url.pathname + url.search + url.hash);
    };
    document.addEventListener('click', routeLink);
    return () => document.removeEventListener('click', routeLink);
  }, [navigate]);
  useEffect(() => {
    const pop = () => { activePath.current = location.pathname; setPath(location.pathname); setRoom(undefined); setError(''); };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    const changed = (event: Event) => {
      if (event instanceof StorageEvent && event.key && !event.key.startsWith('alibi:')) return;
      if (!publicRoute && getSession(mode, code)?.token !== session?.token) { setRoom(undefined); setError(''); }
      refreshSession(value => value + 1);
    };
    window.addEventListener('alibi:sessions-changed', changed); window.addEventListener('storage', changed);
    return () => { window.removeEventListener('alibi:sessions-changed', changed); window.removeEventListener('storage', changed); };
  }, [mode, code, session?.token, publicRoute]);
  useEffect(() => {
    if (kind !== 'host' && location.hash) document.getElementById(routeAnchor(location.hash))?.scrollIntoView();
  }, [path]);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => { if (event.persisted) restartPresence(value => value + 1); };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
  useEffect(() => {
    fetch('/api/config').then(response => response.json()).then(config => setJoinOrigin(publicJoinOrigin(config, location.origin))).catch(() => {});
  }, []);
  useEffect(() => {
    const offline = () => setConnected(false);
    const online = () => { if (!isRoomRoute) setConnected(true); };
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, [isRoomRoute]);

  useEffect(() => {
    if (kind !== 'host' || !validCode) return;
    let alive = true;
    setError(''); setRoom(undefined);
    const claim = async () => {
      try {
        const receipt = captureClaim(code);
        const claimed = await claimMasterSession(code, receipt);
        if (!alive) return;
        claimMemory.delete(code);
        try { sessionStorage.removeItem(`alibi:claim:${code}`); } catch { /* Memory receipt is cleared. */ }
        navigate(`/master/${claimed.code}`);
      } catch (cause) {
        if (!alive) return;
        setRoom(undefined); setError(cause instanceof Error ? cause.message : t("Couldn’t pair this phone. Scan the game master QR again."));
        if (cause instanceof RpcError && cause.network) setConnected(false);
      }
    };
    void claim();
    return () => { alive = false; };
  }, [kind, code, validCode, claimRetry, navigate]);

  useEffect(() => {
    if (!isRoomRoute || !validCode || (!publicRoute && !session)) return;
    let alive = true;
    let terminal = false;
    let presenceClosed = false;
    const clientId = crypto.randomUUID();
    const currentIdentity = () => activePath.current === path && (publicRoute || getSession(mode, code)?.token === session?.token);
    const stopPresence = () => {
      if (presenceClosed) return;
      presenceClosed = true;
      if (session && !publicRoute) closePresence({ code, token: session.token, clientId });
    };
    let inFlight = false;
    let refreshAfter = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!alive || terminal || presenceClosed) return;
      timer = setTimeout(() => { void poll(); }, document.hidden ? 2_500 : 1_000);
    };
    const poll = async () => {
      if (!alive || terminal || presenceClosed) return;
      if (inFlight) { refreshAfter = true; return; }
      inFlight = true;
      try {
        const view = await request<RoomView>('room:subscribe', roomSubscribePayload(kind, code, viewLanguage, session, clientId));
        if (!alive || !currentIdentity()) return;
        receive(view, path, viewLanguage, publicRoute ? undefined : session?.token); setConnected(true); setError('');
      } catch (cause) {
        if (!alive || !currentIdentity()) return;
        if (cause instanceof RpcError && cause.terminal) {
          terminal = true; setRoom(undefined);
          if (!publicRoute) forgetSession(mode, code);
        } else setConnected(false);
        setError(cause instanceof Error ? cause.message : t("Couldn’t reach your room. Check your internet connection."));
      } finally {
        inFlight = false;
        if (refreshAfter && alive && !terminal) { refreshAfter = false; void poll(); }
        else schedule();
      }
    };
    const refresh = () => { if (timer) clearTimeout(timer); void poll(); };
    document.addEventListener('visibilitychange', refresh); window.addEventListener('online', refresh); window.addEventListener('pagehide', stopPresence);
    void poll();
    return () => { alive = false; stopPresence(); if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); window.removeEventListener('pagehide', stopPresence); };
  }, [path, code, kind, mode, validCode, isRoomRoute, session?.token, viewLanguage, receive, presenceGeneration, publicRoute]);
  useEffect(() => {
    if (kind === 'screen' && room?.masterReady) clearPairing(code);
  }, [kind, code, room?.masterReady]);

  const command = async (action: Action) => {
    if (!session || !room) throw new Error(t("Your session is missing. Rejoin this room."));
    if (!connected) throw new Error(t("Reconnecting to your room. Try again in a moment."));
    try {
      const view = await request<RoomView>('room:command', roomCommandPayload(room, session, action, viewLanguage));
      if (activePath.current !== path || getSession(mode, code)?.token !== session.token) return;
      receive(view, path, viewLanguage, session.token); setConnected(true);
    } catch (cause) {
      if (activePath.current !== path || getSession(mode, code)?.token !== session.token) throw cause;
      if (cause instanceof RpcError && cause.network) setConnected(false);
      if (cause instanceof RpcError && cause.terminal) {
        forgetSession(mode, code); setRoom(undefined); setError(cause.message);
      }
      throw cause;
    }
  };
  const create = async (demo = false) => {
    setCreating(true); setError('');
    try {
      const pairing = await prepareDisplayRoom(demo);
      if (activePath.current === path) navigate(`/screen/${pairing.code}`);
    } catch (cause) { if (activePath.current === path) setError(cause instanceof Error ? cause.message : t("Couldn’t create your room. Try again.")); }
    finally { setCreating(false); }
  };
  const createOnPhone = async (demo = false, name = 'Game master') => {
    setCreating(true); setError('');
    try {
      const created = await createPhoneRoom(demo, name);
      if (activePath.current === path) navigate(`/master/${created.code}`);
    } catch (cause) { if (activePath.current === path) setError(cause instanceof Error ? cause.message : t("Couldn’t create your room. Try again.")); }
    finally { setCreating(false); }
  };
  const createRehearsal = async () => {
    setCreating(true); setError('');
    try {
      const created = await request<Session>('room:create', { name: 'Developer', rehearsal: true });
      saveSession('master', created);
      try {
        const player = await request<Session>('room:join', { code: created.code, name: 'Developer', gender: 'any' });
        saveSession('player', player);
      } catch { /* The room remains resumable; its toolbar links to joining a test seat. */ }
      if (activePath.current === path) navigate(`/dev/${created.code}`);
    } catch (cause) { if (activePath.current === path) setError(cause instanceof Error ? cause.message : t('Couldn’t create your room. Try again.')); }
    finally { setCreating(false); }
  };
  const joined = (joinedSession: Session) => { saveSession('player', joinedSession); if (activePath.current === path) navigate(`/play/${joinedSession.code}`); };

  const recovered = (sessionKind: SessionKind, restored: Session) => { saveSession(sessionKind, restored); const current = getSession(sessionKind, restored.code); if (activePath.current === path && current) navigate(`/${sessionKind === 'master' ? 'master' : 'play'}/${current.code}`); };
  if (kind === 'watch' && !hasChosenLanguage) return <div className="connection-page"><LanguagePicker/></div>;
  if (kind === 'watch' && !validCode) return <WatchEntry initialCode={code} onOpen={navigate}/>;
  if (kind === 'films') return <FilmLibrary/>;
  if (kind === 'dev' && !validCode) return <DeveloperStart connected={connected} creating={creating} error={error} onCreate={createRehearsal} onOpen={navigate}/>;
  if (kind === 'recover') return <RecoverSessionForm initialCode={code} initialKind={new URLSearchParams(location.search).get('kind') === 'master' ? 'master' : 'player'} onRecovered={recovered}/>;
  if (kind === 'host' && !code) return <PhoneStart create={createOnPhone} creating={creating} connected={connected} error={error}/>;
  if ((kind === 'screen' || kind === 'master') && !validCode) return <div className="connection-page route-entry-page"><a className="wordmark" href="/">ALIBI<span>®</span></a><CodeLookup mode={kind} invalid={!!code} onOpen={navigate}/><a className="text-button" href="/">{t("Back home")}<ArrowLeft size={16}/></a></div>;
  if (kind === 'host' && !validCode) return <div className="connection-page"><a className="wordmark" href="/">ALIBI<span>®</span></a><div className="connection-message"><h1>{t("That pairing address is incomplete.")}</h1><p>{t("A pairing link needs a four-letter room code. Scan the game master QR again, or create a room on this phone.")}</p><a className="button primary" href="/host">{t("Host on this phone")}<Smartphone size={16}/></a><a className="button secondary" href="/">{t("Back home")}</a></div></div>;
  if (kind === 'join' || (kind === 'play' && !session && !error)) return <Join initialCode={code} onJoined={joined} />;
  if (kind === 'host' || (isRoomRoute && !room)) return <div className="connection-page"><a className="wordmark" href="/">ALIBI<span>®</span></a><div className="connection-message">{error ? <><WifiOff size={36}/><h1>{t("We lost the trail.")}</h1><p role="alert">{t(error)}</p>{kind === 'host' && <button className="button secondary" onClick={() => setClaimRetry(value => value + 1)}>{t("Try pairing again")}</button>}<button className="button primary" onClick={() => navigate(kind === 'play' ? `/join/${code}` : '/')}>{t(kind === 'play' ? 'Back to join' : 'Back to home')}<ArrowLeft size={16}/></button></> : (kind === 'master' || kind === 'dev') && !session ? <><h1>{t("Keep the controls close.")}</h1><p>{t("Open this room on the phone that created or paired with it. Your private controls are saved in that browser.")}</p><button className="button primary" onClick={() => navigate('/')}>{t("Back to home")}</button></> : <><LoaderCircle className="spin" size={30}/><h1>{kind === 'host' ? t("Pairing your phone…") : t("Connecting the dots…")}</h1><p>{kind === 'host' ? t("Your private game master controls are on their way.") : t('Finding room {code}. Keep this window open.', { code })}</p></>}{validCode && !publicRoute && <><a className="recovery-text-link" href={`/recover/${code}?kind=${mode}`}>{t('Using another phone? Recover your access')}<ArrowUpRight size={16}/></a><SavedGames code={code}/></>}</div></div>;
  const upgradeNotice = room?.notice ? <aside className="room-upgrade-notice" role="status">{room.notice}</aside> : null;
  if (kind === 'dev' && room && !room.rehearsal) return <DeveloperStart connected={connected} creating={creating} error={t('This is a party room. Use its private phone controls, or create a separate rehearsal below.')} onCreate={createRehearsal} onOpen={navigate}/>;
  if (kind === 'dev' && room) return <div className="developer-run">{upgradeNotice}<RehearsalControls room={room} connected={connected} command={command}/><Display room={{ ...room, isMaster: false, me: undefined }} connected={connected} joinOrigin={joinOrigin} developerControls/></div>;
  if (kind === 'screen' && room) return <>{upgradeNotice}<Display room={room} connected={connected} joinOrigin={joinOrigin} pairing={getPairing(code)}/></>;
  if (kind === 'watch' && room) return <>{upgradeNotice}<SpectatorPanel room={audienceRoom(room)} connected={connected} onJoin={() => navigate(`/join/${code}`)} onHome={() => navigate('/')}/></>;
  if (kind === 'master' && room) return <>{upgradeNotice}<Master room={room} connected={connected} command={command} joinOrigin={joinOrigin} onHome={() => navigate('/')}/></>;
  if (kind === 'play' && room) return <>{upgradeNotice}<Player room={room} command={command} connected={connected} onLeave={() => navigate(`/join/${code}`)} onMasterSession={restored => recovered('master', restored)} onReleased={() => { forgetSession('player', code); navigate(`/join/${code}`); }}/></>;
  return <ArcadeHome page={kind === 'cast' ? 'cast' : kind === 'party-kit' ? 'kit' : 'home'} connected={connected} create={create} creating={creating} error={error} onJoin={() => navigate('/join')} homeExtra={<><CodeLookup mode="screen" onOpen={navigate}/><a className="text-button" href="/watch">{watchCopy(language).home}<ArrowUpRight size={16}/></a><SavedGames/></>}/>;
}

function CodeLookup({ mode, invalid = false, onOpen }: { mode: 'screen' | 'master'; invalid?: boolean; onOpen: (path: string) => void }) {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  const isDisplay = mode === 'screen';
  return <section className="home-display-lookup"><div><span className="eyebrow">{isDisplay ? <Monitor size={15}/> : <Smartphone size={15}/>} {isDisplay ? t('THE COMPUTER / TV SCREEN') : t("PRIVATE PHONE CONTROLS")}</span><h2>{invalid ? t("Find your room again.") : isDisplay ? t("Already created a room on your phone?") : t("Return to your game master controls.")}</h2><p>{invalid ? t("This address needs a four-letter room code. Enter the code from your game master’s phone.") : isDisplay ? t("Keep the game master controls on your phone. Enter the room code here to open its public display.") : t("Enter your four-letter room code on the phone that created or paired with the room. Your private controls are saved in that browser.")}</p>{!isDisplay && <a className="text-button lookup-host-link" href="/host">{t("Host on this phone")}<ArrowUpRight size={15}/></a>}</div><form onSubmit={event => { event.preventDefault(); if (/^[A-Z]{4}$/.test(value)) onOpen(`/${mode}/${value}`); }}><label htmlFor="display-code">{t("Room code")}</label><div><input id="display-code" value={value} onChange={event => setValue(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="ABCD" maxLength={4} pattern="[A-Z]{4}" autoComplete="off" autoCapitalize="characters" spellCheck={false} required/><button className="button secondary" type="submit">{isDisplay ? t("Open display") : t("Open controls")}<ArrowUpRight size={16}/></button></div></form></section>;
}

function PhoneStart({ create, creating, connected, error }: { create: (demo?: boolean, name?: string) => Promise<void>; creating: boolean; connected: boolean; error: string }) {
  const { t, language } = useLanguage();
  const [name, setName] = useState('');
  return <div className="phone-start-page" lang={language}><header><a className="wordmark" href="/">ALIBI<span>®</span></a><LanguageMenu/><a className="text-button" href="/">{t("Back home")}<ArrowLeft size={16}/></a></header><main className="phone-start-main"><span className="eyebrow"><Smartphone size={16}/> {t("PRIVATE PHONE CONTROLS")}</span><div className="phone-start-emblem" aria-hidden="true"><LockKeyhole size={42} strokeWidth={1}/></div><h1>{t("Run the")}<br/><em>{t("Wild Weird West.")}</em></h1><p>{t("Create a Blood Moon over Dustfall room here. This phone becomes the game master controller. Open the public display on a computer or TV, then invite your suspects.")}</p><div className="phone-start-note"><LockKeyhole size={18}/><span>{t("Your private phone controls stay saved in this browser. You set the pace of every act.")}</span></div>{error && <p className="phone-start-error" role="alert">{t(error)}</p>}{!connected && <p className="phone-start-error" role="status">{t("Check your internet connection, then try again.")}</p>}<label className="phone-start-name">{t("Game master name")}<input maxLength={24} autoComplete="nickname" value={name} placeholder={t("Your name")} onChange={event => setName(event.target.value)}/></label><button className="button primary" disabled={creating || !connected} onClick={() => create(false, name.trim() || "Game master")}>{creating ? t("Creating your room…") : t("Create room")}<ArrowUpRight size={19}/></button><button className="button secondary" disabled={creating || !connected} onClick={() => create(true, name.trim() || "Game master")}>{t("Try with sample players")}<Users size={17}/></button><a className="phone-start-guest" href="/join">{t("Playing as a suspect? Join a room")}<ArrowUpRight size={15}/></a><SavedGames kind="master"/></main><footer><Users size={15}/> {t("4–20 players + one game master")}</footer></div>;
}
