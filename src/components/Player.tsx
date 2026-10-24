import { useEffect, useRef, useState } from 'react';
import { gameStepIdentity } from '../../shared/game-step';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, CircleHelp, Eye, EyeOff, Flag, LockKeyhole, Radio, ScanLine, ShieldCheck, Star, Users, WifiOff, X } from 'lucide-react';
import type { Action, Gender, PlayerView, Role, RoomView, Session } from '../../shared/types';
import { characterById, entrySeal } from '../../shared/characters';
import { getSession, request } from '../client';
import { LanguageMenu, LanguagePicker, useLanguage } from '../i18n';
import { PhoneCaptions } from './PhoneCaptions';
import { GameMasterStatus, PlayerRecovery, SavedGames } from './RoomRecovery';
import { PublicEvidence } from './PublicEvidence';
import { PhoneMoves } from './PhoneMoves';
import type { PhoneMoveId } from '../../shared/phone-moves';
import { useCountdown } from '../useCountdown';
import { useAttentionCountdown } from '../useAttentionCountdown';
import { AttentionOverlay } from './AttentionOverlay';
import { formatTime } from '../../shared/format';

type JoinProps = { initialCode?: string; onJoined: (session: Session) => void };
const preferences: { value: Gender; label: string }[] = [{ value: 'man', label: 'Man' }, { value: 'woman', label: 'Woman' }, { value: 'any', label: 'Either' }];

export function Join({ initialCode = '', onJoined }: JoinProps) {
  const { t, language, hasChosenLanguage } = useLanguage();
  const [code, setCode] = useState(initialCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [loading, setLoading] = useState(false);
  const joining = useRef(false);
  const [error, setError] = useState('');
  const savedSeat = getSession('player', code);
  useEffect(() => { setCode(initialCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)); }, [initialCode]);
  useEffect(() => { setError(''); }, [language]);
  async function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joining.current) return;
    const currentSeat = getSession('player', code);
    if (currentSeat) { onJoined(currentSeat); return; }
    setError('');
    if (!/^[A-Z]{4}$/.test(code)) { setError(t("Enter the four-letter room code on the big screen.")); return; }
    if (!name.trim()) { setError(t("Add your name so the other players know who you are.")); return; }
    if (!gender) { setError(t("Choose a man, woman, or either for your character before joining.")); return; }
    joining.current = true; setLoading(true);
    try { onJoined(await request<Session>('room:join', { code, name: name.trim(), gender })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Couldn’t join. Check the code and available seats with your host.")); joining.current = false; setLoading(false); }
  }
  if (!hasChosenLanguage) return <div className="join-page join-language-page"><header className="join-header"><a className="join-brand" href="/" aria-label="ALIBI">ALIBI<span>★</span></a></header><main className="join-language-main"><LanguagePicker /></main></div>;
  return <div className="join-page" lang={language}>
    <header className="join-header"><a className="join-brand" href="/" aria-label={t("ALIBI home")}>ALIBI<span>★</span></a><div className="join-header-actions"><LanguageMenu /><a className="join-back" href="/"><ArrowLeft size={16} /> {t("Back home")}</a></div></header>
    <main className="join-layout">
      <section className="join-intro"><span className="phone-kicker">{t("COWBOYS VS ALIENS · 4–20 PLAYERS")}</span><h1>{t("Blood Moon")}<br /><span>{t("over Dustfall")}</span></h1><p>{t("One town. Two worlds. A very dead mayor. Step into a character, search for clues, and find the killer before the final accusation.")}</p><div className="join-poster"><img src="/assets/characters/silas-vale.webp" alt={t("Marshal Silas Vale, one of Dustfall’s suspects")} /><strong>{t("EVERYBODY HAS AN ALIBI.")}</strong></div></section>
      <section className="join-form-panel" aria-labelledby="join-title"><span className="phone-kicker">{t("YOUR TICKET TO DUSTFALL")}</span><h2 id="join-title">{t("Saddle up, suspect.")}</h2><p>{t("Keep this phone close. Your secrets live here.")}</p>
        {savedSeat && <a className="phone-button join-resume" href={'/play/' + code}>{savedSeat.name ? t("Return as {name}", { name: savedSeat.name }) : t("Return to your saved seat")}<ArrowRight size={18} /></a>}{savedSeat?.characterName && <p>{savedSeat.characterName}</p>}
        <form onSubmit={join} className="join-form">
          <label className="join-field" htmlFor="join-code">{t("Room code")}<input id="join-code" className="join-code-input" value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="DUST" maxLength={4} autoComplete="off" autoCapitalize="characters" spellCheck={false} required /><small>{t("The four letters on the big screen.")}</small></label>
          {!savedSeat && <><label className="join-field" htmlFor="join-name">{t("Your name")}<input id="join-name" value={name} onChange={event => setName(event.target.value)} placeholder={t("What should we call you?")} maxLength={24} autoComplete="nickname" required /></label>
          <fieldset className="join-gender"><legend>{t("Choose your character’s gender")}</legend><div className="join-gender-options">{preferences.map(option => <label key={option.value} className={`join-choice ${gender === option.value ? 'is-selected' : ''}`}><input type="radio" name="gender" value={option.value} checked={gender === option.value} onChange={() => setGender(option.value)} required /><span>{t(option.label)}</span>{gender === option.value && <Check size={16} />}</label>)}</div><p>{t("This is your character preference. Ten men and ten women are available; “Either” fills either available seat.")}</p></fieldset>
          {error && <div className="join-error" role="alert"><CircleHelp size={18} /><span>{t(error)}</span></div>}
          <button className="phone-button join-submit" type="submit" disabled={loading}>{loading ? t("Finding your seat…") : t("Join the mystery")}<ArrowRight size={21} /></button></>}
        </form><SavedGames code={code || undefined} kind="player"/><p className="join-note"><LockKeyhole size={14} /> {t("No account. Just a good poker face.")}</p>
      </section>
    </main>
  </div>;
}

type PlayerProps = { room: RoomView; command: (action: Action) => Promise<void>; connected: boolean; onLeave: () => void; onMasterSession?: (session: Session) => void; onReleased?: () => void };
const phaseLabels: Record<RoomView['phase'], string> = { lobby: 'Welcome to Dustfall', roles: 'Your secret identity', investigation: 'Follow the evidence', voting: 'Final accusation', results: 'The truth is out' };

function Portrait({ person, className = '' }: { person?: PlayerView; className?: string }) {
  const character = characterById(person?.characterId ?? '');
  return character ? <img className={`phone-portrait ${className}`} src={character.portrait} alt="" loading="lazy" /> : <span className={`phone-portrait phone-portrait-placeholder ${className}`} aria-hidden="true">★</span>;
}

export function CharacterDossier({ role }: { role?: Role }) {
  const { t } = useLanguage();
  const sealLabel = (id: string) => { const seal = entrySeal(id); return `${t(seal.color)} ${t(seal.symbol)}`; };
  const [tab, setTab] = useState<'profile' | 'secrets' | 'missions'>('profile');
  const [privateOpen, setPrivateOpen] = useState(false);
  const profile = characterById(role?.characterId ?? '');
  useEffect(() => { setTab('profile'); setPrivateOpen(false); }, [role?.characterId, role?.secret]);
  function select(next: typeof tab) { setTab(next); setPrivateOpen(false); }
  return <section className="phone-dossier" aria-label={t("Your private character")}>
    <div className="phone-wanted"><span className="phone-wanted-kicker">{t("★ YOUR SECRET IDENTITY ★")}</span>{profile ? <img className="phone-wanted-portrait" src={profile.portrait} alt={profile.name} /> : <div className="phone-wanted-fallback">★</div>}<div className="phone-nameplate"><h2>{profile?.name ?? role?.name ?? t("Character incoming")}</h2><p>{(profile?.title ? t(profile?.title) : undefined) ?? t("Your Dustfall dossier")}</p><span>{(profile?.faction ? t(profile?.faction) : undefined) ?? t("Eclipse Saloon")}</span>{profile && <strong className="phone-entry-seal" data-seal-color={entrySeal(profile.id).color}>{t("PUBLIC SEAL · {seal}", { seal: sealLabel(profile.id) })}</strong>}</div></div>
    <div className="phone-dossier-tabs" role="tablist" aria-label={t("Character dossier")}>{(['profile', 'secrets', 'missions'] as const).map(item => <button key={item} id={`dossier-${item}`} type="button" role="tab" aria-selected={tab === item} aria-controls="dossier-content" className={tab === item ? 'is-active' : ''} onClick={() => select(item)}>{item === 'profile' ? <Users size={16} /> : item === 'secrets' ? <LockKeyhole size={16} /> : <Flag size={16} />}{t(item)}</button>)}</div>
    <div className={`phone-dossier-content ${tab === 'secrets' ? 'is-secret' : ''}`} id="dossier-content" role="tabpanel" aria-labelledby={`dossier-${tab}`}>
      {tab === 'profile' && <>{profile && <div className="phone-seal-explainer"><strong>{t("Admission seal: {seal}", { seal: sealLabel(profile.id) })}</strong><p>{t("Your entry seal is public. Compare its color and symbol with the evidence.")}</p></div>}<h3>{t("Who you are")}</h3><p>{role?.background ?? role?.brief ?? (profile?.bio ? t(profile?.bio) : undefined) ?? t("Your host is preparing your character.")}</p>{profile && <><h3>{t("Your personality")}</h3><p>{t(profile.personality)}</p></>}<h3>{t("Your alibi")}</h3><p>{role?.alibi ?? t("Compare your story with the other guests.")}</p>{profile && <><h3>{t("Costume cue")}</h3><p>{t(profile.costume)}</p></>}</>}
      {tab === 'secrets' && <>{!privateOpen ? <div className="phone-secret-cover"><LockKeyhole size={30} /><h3>{t("For your eyes only.")}</h3><p>{t("Check who’s looking before opening this part of your file.")}</p><button className="phone-button" onClick={() => setPrivateOpen(true)}><Eye size={18} /> {t("Reveal my secret")}</button></div> : <><div className="phone-secret-label"><strong>{role?.alignment === 'culprit' ? t("PRIVATE · YOU ARE THE CULPRIT") : t("PRIVATE · YOUR SECRET")}</strong><button className="phone-icon-button" aria-label={t("Hide my secret")} onClick={() => setPrivateOpen(false)}><EyeOff size={20} /></button></div><p>{role?.secret ?? t("Your secret will appear when the host deals characters.")}</p>{role?.objective && <><h3>{t("Your private instruction")}</h3><p>{role.objective}</p></>}<p className="phone-secret-warning">{t("Keep this screen to yourself. Choose what you tell the other guests.")}</p></>}</>}
      {tab === 'missions' && <><h3>{t("Your goals")}</h3><ol>{(role?.objectives?.length ? role.objectives : [role?.objective ?? t("Meet the other guests and follow the evidence.")]).map((objective, index) => <li key={index}>{objective}</li>)}</ol><h3>{t("People you know")}</h3>{role?.relationships?.length ? role.relationships.map((relationship, index) => <p key={index}><strong>{relationship.name}</strong><br />{relationship.detail}</p>) : <p>{t("Introduce yourself at the Eclipse Saloon.")}</p>}<h3>{t("Play your part")}</h3><p>{role?.roleplayTip ?? t("Stay in character, ask questions, and let everyone have a turn.")}</p></>}
    </div>
  </section>;
}

function AnswerFeedback({ room, final = false }: { room: RoomView; final?: boolean }) {
  const { t } = useLanguage();
  if (!room.questionResult) return null;
  const previous = room.me?.previousAnswer?.round === room.questionResult.round ? room.me.previousAnswer : undefined;
  return <section className="phone-feedback"><span className="phone-kicker">{t("ACT {round} · ANSWER EXPLAINED", { round: room.questionResult.round })}</span>{previous && <p data-answer-option={previous.optionId} data-answer-round={previous.round}><strong>{previous.correct ? t("Correct · +100 points!") : final ? t("The final case answer") : t("A clue for next time.")}</strong><br />{t("You answered: {answer}", { answer: previous.text })}</p>}<p>{room.questionResult.explanation}</p></section>;
}

/** Phase and round, rather than polling revisions, define a new phone chapter. */
export function phoneStage(room: Pick<RoomView, 'code' | 'gameId' | 'phase' | 'round' | 'settings'>) {
  const total = room.settings.rounds + 3;
  const current = room.phase === 'lobby' || room.phase === 'roles' ? 0 : room.phase === 'investigation' ? Math.max(1, Math.min(room.settings.rounds, room.round)) : room.phase === 'voting' ? total - 2 : total - 1;
  const content = room.phase === 'roles' ? ['Your character is ready', 'Read your dossier. Keep your secrets close.'] : room.phase === 'investigation' ? ['ACT {round}', 'New evidence. New questions. Trust your instincts.'] : room.phase === 'voting' ? ['Time to accuse', 'Review the clues. Your final vote is yours alone.'] : room.phase === 'results' ? ['The truth revealed', 'See how the evidence fits together.'] : ['A new mystery awaits', 'Your seat is saved. Wait for the host.'];
  return { key: `${room.code}:${room.gameId ?? ''}:${room.phase}:${room.phase === 'investigation' ? room.round : 0}`, current, total, title: content[0], description: content[1], round: room.round };
}

export function PhoneRoundProgress({ room }: { room: RoomView }) {
  const { t } = useLanguage();
  const stage = phoneStage(room);
  const labels = [t('Characters'), ...Array.from({ length: room.settings.rounds }, (_, index) => t('ACT {round}', { round: index + 1 })), t('Accuse'), t('Reveal')];
  return <nav className="phone-round-progress" aria-label={t('Case progress')} data-stage={stage.current}>
    <ol>{labels.map((label, index) => <li key={index} className={index < stage.current ? 'is-complete' : index === stage.current ? 'is-current' : ''} aria-current={index === stage.current ? 'step' : undefined}><span className="phone-progress-marker" aria-hidden="true">{index < stage.current ? <Check size={12} /> : index === 0 ? <Users size={12} /> : index === labels.length - 1 ? <Star size={12} /> : index === labels.length - 2 ? <ShieldCheck size={12} /> : index}</span><span>{label}</span></li>)}</ol>
  </nav>;
}

export function actionFeedback(action: Action): string {
  return action.type === 'ready' ? 'Ready status saved' : action.type === 'search' ? 'Private discovery saved · +25 points' : action.type === 'answer' ? 'Answer sealed for this act' : action.type === 'publish-clue' ? 'Clue shared with the table · +25 points' : action.type === 'suspect' ? 'Anonymous suspicion updated' : action.type === 'vote' ? 'Final accusation sealed' : 'Action saved';
}

export function Player({ room, command, connected, onLeave, onMasterSession, onReleased }: PlayerProps) {
  const { t, language } = useLanguage();
  const stepIdentity = gameStepIdentity(room);
  const sealLabel = (id: string) => { const seal = entrySeal(id); return `${t(seal.color)} ${t(seal.symbol)}`; };
  const [tab, setTab] = useState<'case' | 'character'>('case');
  const [selection, setSelection] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const searchHeading = useRef<HTMLHeadingElement>(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const privateClues = useRef<HTMLDetailsElement>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ key: number; message: string }>();
  const [transition, setTransition] = useState<ReturnType<typeof phoneStage>>();
  const chapter = phoneStage(room);
  const lastChapter = useRef(chapter.key);
  const timer = formatTime(useCountdown(room.timer, room.serverNow));
  const attentionSeconds = useAttentionCountdown(room);
  const me = room.me;
  const player = room.players.find(item => item.id === me?.playerId);
  const disabled = !connected || room.timer.isPaused || attentionSeconds > 0 || pending !== null || !me;
  const selectedPlayer = room.players.find(item => item.id === selection);
  const votedPlayer = room.players.find(item => item.id === me?.votedFor);
  const culprit = room.players.find(item => item.id === room.result?.culpritId);
  const award = room.result?.scores?.find(item => item.playerId === me?.playerId);
  useEffect(() => { setError(''); setSuccess(undefined); setSelection(null); setConfirmation(false); setLeaving(false); setTab('case'); }, [room.code, stepIdentity, me?.playerId]);
  useEffect(() => { setError(''); }, [language]);
  useEffect(() => {
    if (lastChapter.current === chapter.key) return;
    lastChapter.current = chapter.key;
    setTransition(chapter);
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1600 : 3200;
    const timeout = window.setTimeout(() => setTransition(undefined), duration);
    return () => window.clearTimeout(timeout);
  }, [chapter.key]);
  useEffect(() => {
    if (!success) return;
    const timeout = window.setTimeout(() => setSuccess(undefined), 3200);
    return () => window.clearTimeout(timeout);
  }, [success]);
  useEffect(() => {
    if (!confirmation && !leaving) return;
    const before = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    function keys(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pendingRef.current) { setConfirmation(false); setLeaving(false); }
      if (event.key !== 'Tab') return;
      const controls = dialog?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
      if (!controls?.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); before?.focus(); };
  }, [confirmation, leaving]);
  async function act(action: Action, key: string) {
    if (disabled || pendingRef.current) return;
    pendingRef.current = true; setPending(key); setError('');
    try { await command(action); setConfirmation(false); setSuccess({ key: Date.now(), message: actionFeedback(action) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong. Please try again.")); }
    finally { pendingRef.current = false; setPending(null); }
  }
  function navigateMove(id: PhoneMoveId) {
    if (id === 'share' && privateClues.current) privateClues.current.open = true;
    const target = id === 'search' ? searchHeading.current : id === 'answer' ? answerHeading.current : privateClues.current?.querySelector('summary');
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function suspectGrid(final: boolean) {
    return <div className="phone-suspect-grid" role="group" aria-label={final ? t("Choose your final suspect") : t("Your changeable suspicion")}>{room.players.filter(person => person.id !== me?.playerId).map(person => {
      const selected = final ? selection === person.id : me?.suspicionId === person.id;
      const profile = characterById(person.characterId ?? '');
      return <button key={person.id} type="button" className={`phone-suspect ${selected ? 'is-selected' : ''}`} aria-pressed={selected} disabled={disabled} onClick={() => final ? setSelection(person.id) : void act({ type: 'suspect', playerId: person.id }, `suspect-${person.id}`)}><Portrait person={person} /><span className="phone-suspect-name">{person.name}<small>{profile?.name ?? person.roleName ?? t("Suspect")}</small>{profile && <small className="phone-entry-seal" data-seal-color={entrySeal(profile.id).color}>{t("SEAL · {seal}", { seal: sealLabel(profile.id) })}</small>}</span><span className="phone-suspect-mark">{selected ? <Check size={16} /> : final ? '＋' : '?'}</span></button>;
    })}</div>;
  }
  if (attentionSeconds > 0) return <div className="phone-page" lang={language}><AttentionOverlay room={room} connected={connected} variant="phone" /></div>;
  return <div className="phone-page" lang={language}>
    <header className="phone-header"><div className="phone-header-line"><a href="/" className="phone-brand" aria-label={t("ALIBI home")}>ALIBI<span>★</span></a><div className="phone-room-label">{t("ROOM")} <strong>{room.code}</strong><span className={`phone-connected-dot ${connected ? '' : 'is-offline'}`} aria-label={connected ? t("Connected") : t("Disconnected")} /></div><button className="phone-icon-button" aria-label={t("Step away")} onClick={() => setLeaving(true)}><X size={21} /></button></div><div className="phone-language-bar"><span><LockKeyhole size={12}/>{t('YOUR PRIVATE PHONE')}</span><LanguageMenu /></div></header>
    <main className="phone-main">
      {room.phase !== 'lobby' && <PhoneRoundProgress room={room} />}
      <PhoneCaptions room={room} connected={connected} /><GameMasterStatus room={room}/>{room.rehearsal && <p className="phone-notice" role="status">{t("Developer rehearsal · test game")}</p>}
      {!connected && <div className="phone-notice is-warning" role="status"><WifiOff size={20} /><span>{t("Reconnecting. Your seat and submitted actions are saved.")}</span></div>}
      {room.timer.isPaused && room.phase !== 'lobby' && <div className="phone-notice" role="status"><strong>Ⅱ</strong><span>{t("Game paused. Your host will resume the action.")}</span></div>}
      {error && <div className="phone-notice is-warning" role="alert"><CircleHelp size={20} /><span>{t(error)}</span><button className="phone-icon-button" aria-label={t("Dismiss error")} onClick={() => setError('')}><X size={18} /></button></div>}
      <div className="phone-overline"><span>{t(phaseLabels[room.phase])}</span><span>{player?.name ?? t("YOUR PRIVATE FILE")}</span></div>
      {room.phase !== 'lobby' && <div className="phone-score"><Star size={16} /><strong>{me?.score ?? award?.score ?? 0}</strong> {t("POINTS")}<span>{t("YOUR PRIVATE PHONE")}</span><LockKeyhole size={14} /></div>}
      {room.phase === 'lobby' && <><section className="phone-welcome"><span className="phone-kicker">{t("YOUR SEAT IS SAVED")}</span><h1>{t("Welcome to")}<br /><em>Dustfall.</em></h1><p>{t("Look alive, {name}. Your character arrives when the game master starts the mystery.", { name: player?.name ?? t("suspect") })}</p><div className="phone-waiting"><span className="phone-connected-dot" /> {t("Waiting for the host")}</div></section><section className="phone-panel"><div className="phone-section-title"><h2>{t("The usual suspects")}</h2><span>{room.players.length} / {room.settings.maxPlayers}</span></div><div className="phone-roster-list">{room.players.map((person, index) => <div className="phone-roster-person" key={person.id}><span className="phone-seat-number">{String(index + 1).padStart(2, '0')}</span><strong>{person.name}{person.id === me?.playerId && <small> {t("YOU")}</small>}</strong><span className={`phone-connected-dot ${person.connected ? '' : 'is-offline'}`} aria-label={person.connected ? t("Connected") : t("Disconnected")} /></div>)}</div></section></>}
      {room.phase === 'roles' && <><h1 className="phone-screen-title">{t("Your character dossier")}</h1><CharacterDossier role={me?.role} /><button className={`phone-button phone-ready ${me?.ready ? 'is-ready' : ''}`} disabled={disabled || !me?.role} onClick={() => void act({ type: 'ready', ready: !me?.ready }, 'ready')}>{me?.ready ? <CheckCheck size={23} /> : <Check size={23} />}{pending === 'ready' ? t("Saving…") : me?.ready ? t("I’m ready · Tap to undo") : t("I’m ready")}<ArrowRight size={23} /></button><p className="phone-action-hint">{t("Read your profile, secrets and missions. Your private file stays available throughout the game.")}</p><div className="phone-readiness"><Users size={17} />{t("{ready} of {total} players ready", { ready: room.players.filter(person => person.ready).length, total: room.players.length })}</div></>}
      {room.phase === 'investigation' && <><div className="phone-investigation-title"><div><span className="phone-kicker">{t("ACT {round} / {total}", { round: room.round, total: room.settings.rounds })}</span><h1>{room.act?.title ?? t("Follow the evidence")}</h1></div><div className="phone-timer"><strong>{timer}</strong><span>{room.timer.isPaused ? t("PAUSED") : timer === '00:00' ? t("HOST TO CONTINUE") : t("REMAINING")}</span></div></div><div className="phone-case-tabs" role="tablist" aria-label={t("Your case file")}>{(['case', 'character'] as const).map(item => <button key={item} id={`phone-${item}-tab`} role="tab" aria-selected={tab === item} aria-controls="phone-case-content" className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item === 'case' ? <ScanLine size={18} /> : <Users size={18} />}{item === 'case' ? t("The case") : t("My character")}</button>)}</div><div id="phone-case-content" role="tabpanel" aria-labelledby={`phone-${tab}-tab`}>{tab === 'character' ? <CharacterDossier role={me?.role} /> : <>
        {room.act && <><p className="phone-act-prompt">{room.act.prompt}</p><PhoneMoves room={room} onNavigate={navigateMove} /><PublicEvidence room={room} /><section className="phone-action-section"><div className="phone-section-title"><h2 id="phone-search-heading" ref={searchHeading} tabIndex={-1} className="phone-move-target">{t("01 · Search a location")}</h2><span>{t("+25 POINTS")}</span></div><p>{t("One search per act. Your discovery stays on your phone.")}</p>{me?.search ? <article className="phone-search-receipt" role="status"><span className="phone-kicker"><CheckCheck size={15} /> {t("SEARCH COMPLETE · PRIVATE")}</span><h3>{me.search.title}</h3><p>{me.search.text}</p></article> : <div className="phone-search-grid">{room.act.locations.map((location, index) => <button className="phone-search-tile" key={location.id} disabled={disabled} onClick={() => void act({ type: 'search', locationId: location.id }, `search-${location.id}`)}><span aria-hidden="true">{['⌕', '✦', '⚒'][index % 3]}</span><strong>{pending === `search-${location.id}` ? t("Searching…") : location.label}</strong><small>{location.description}</small></button>)}</div>}</section>
        <section className="phone-action-section"><div className="phone-section-title"><h2 id="phone-answer-heading" ref={answerHeading} tabIndex={-1} className="phone-move-target">{t("02 · Crack the case")}</h2><span>{t("+100 IF CORRECT")}</span></div><p className="phone-question-prompt">{room.act.question.prompt}</p><div className="phone-answer-options">{room.act.question.options.map((option, index) => <button key={option.id} className={`phone-answer ${me?.answeredOptionId === option.id ? 'is-selected' : ''}`} disabled={disabled || me?.answeredOptionId !== undefined} onClick={() => void act({ type: 'answer', optionId: option.id }, `answer-${option.id}`)}><span>{String.fromCharCode(65 + index)}</span>{option.text}{me?.answeredOptionId === option.id && <Check size={20} />}</button>)}</div>{me?.answeredOptionId ? <p className="phone-answer-receipt" role="status"><LockKeyhole size={16} />{t("Answer locked. The answer and points are revealed when this act closes.")}</p> : <p className="phone-action-hint">{t("Tap once to submit. Your answer is final for this act.")}</p>}</section></>}
        <AnswerFeedback room={room} />
        <details ref={privateClues} className="phone-accordion phone-private-clues"><summary>{t("Your private clues")} <span>{me?.clues.length ?? 0}</span><ChevronDown size={18} /></summary><div className="phone-evidence-body">{!me?.clues.length && <p>{t("Your next assigned clue is on its way.")}</p>}{[...(me?.clues ?? [])].reverse().map(clue => <article className="phone-evidence-paper" key={clue.id}><span className="phone-kicker">{t("ACT {round} · {visibility}", { round: clue.round, visibility: clue.published ? t("SHARED") : t("PRIVATE") })}</span><h3>{clue.title}</h3><p>{clue.text}</p><button className="phone-button phone-publish" disabled={disabled || clue.published} onClick={() => void act({ type: 'publish-clue', clueId: clue.id }, `share-${clue.id}`)}>{clue.published ? <><CheckCheck size={17} />{t("Shared with the table")}</> : <><Radio size={17} />{pending === `share-${clue.id}` ? t("Sharing…") : t("Share clue · +25")}</>}</button></article>)}</div></details>
        <section className="phone-action-section"><div className="phone-section-title"><h2>{t("03 · Who looks suspicious?")}</h2><span>{t("CHANGE ANYTIME")}</span></div><p>{t("Your choice is anonymous. Change it as the evidence changes.")}</p>{suspectGrid(false)}<div className="phone-suspicion-chart" aria-label={t("Anonymous suspicion totals")}><h3>{t("The town’s suspicions")}</h3>{room.players.map(person => <div className="phone-suspicion-row" key={person.id}><span>{person.name}</span><div><span style={{ width: `${((room.suspicions?.[person.id] ?? 0) / Math.max(1, room.players.length)) * 100}%` }} /></div><strong>{room.suspicions?.[person.id] ?? 0}</strong></div>)}</div></section>
      </>}</div></>}
      {room.phase === 'voting' && <><span className="phone-kicker">{t("ONE SHOT. MAKE IT COUNT.")}</span><h1 className="phone-page-title">{t("Draw your")}<br /><em>{t("conclusions.")}</em></h1><p className="phone-description">{t("Who killed Mayor Graves? Review the evidence, then seal your final accusation. A correct accusation earns 200 points.")}</p><PublicEvidence room={room} /><AnswerFeedback room={room} />{me?.votedFor ? <section className="phone-vote-receipt"><LockKeyhole size={30} /><span className="phone-kicker">{t("ACCUSATION FILED")}</span><Portrait person={votedPlayer} /><h2>{votedPlayer?.name ?? t("Your suspect")}</h2><p>{t("Your vote is sealed and final. The truth comes out when the host reveals the result.")}</p></section> : <>{suspectGrid(true)}<button className="phone-button phone-vote-submit" disabled={disabled || !selection} onClick={() => setConfirmation(true)}>{t("Make my accusation")}<ArrowRight size={22} /></button><p className="phone-action-hint">{t("You’ll confirm before your vote is sealed.")}</p></>}<div className="phone-readiness"><ShieldCheck size={18} />{t("{votes} of {total} accusations filed", { votes: room.votesCount, total: room.players.length })}</div><details className="phone-accordion"><summary>{t("Review my character")}<ChevronDown size={18} /></summary><CharacterDossier role={me?.role} /></details></>}
      {room.phase === 'results' && <><span className="phone-kicker">{t("THE VERDICT IS IN")}</span><h1 className="phone-page-title">{room.result?.caught ? <>{t("Caught.")}<br /><em>{t("Red-handed.")}</em></> : <>{t("A perfect")}<br /><em>{t("getaway.")}</em></>}</h1><section className="phone-culprit-card"><span className="phone-kicker">{t("THE CULPRIT WAS")}</span><Portrait person={culprit} /><h2>{culprit?.name ?? t("Awaiting the reveal")}</h2><p>{characterById(culprit?.characterId ?? '')?.name ?? culprit?.roleName}</p>{me?.playerId === culprit?.id && <strong>{t("THAT WOULD BE YOU.")}</strong>}</section><section className="phone-award"><Star size={29} /><span>{t("YOUR DUSTFALL AWARD")}</span><strong>{award?.score ?? me?.score ?? 0} {t("POINTS")}</strong><p>{me?.playerId === culprit?.id ? room.result?.caught ? t("A memorable villain. The evidence caught up with you.") : t("Master of the getaway · +200 escape bonus.") : award?.correctAccusation ? t("Sharp-eyed detective · +200 for your accusation.") : t("A fearless investigator. Every clue helped tell the story.")}</p>{award && <small>{t(award.searches === 1 ? "{count} search" : "{count} searches", { count: award.searches })} · {t(award.cluesShared === 1 ? "{count} clue shared" : "{count} clues shared", { count: award.cluesShared })} · {t(award.correctAnswers === 1 ? "{count} correct answer" : "{count} correct answers", { count: award.correctAnswers })}</small>}</section>{room.result?.solution && <section className="phone-solution"><span className="phone-kicker">{t("HOW IT HAPPENED")}</span><h2>{room.result.solution.headline}</h2><p>{room.result.solution.summary}</p><h3>{t("The method")}</h3><p>{room.result.solution.method}</p><h3>{t("The motive")}</h3><p>{room.result.solution.motive}</p><h3>{t("The timeline")}</h3><ol>{room.result.solution.timeline.map((entry, index) => <li key={index}><strong>{entry.time}</strong><p>{entry.text}</p></li>)}</ol></section>}<section className="phone-panel"><div className="phone-section-title"><h2>{t("The accusations")}</h2><span>{t("{votes} VOTES", { votes: room.votesCount })}</span></div>{[...room.players].sort((a, b) => (room.result?.tallies[b.id] ?? 0) - (room.result?.tallies[a.id] ?? 0)).map(person => <div className="phone-tally-row" key={person.id}><span>{person.name}{person.id === culprit?.id && <small> {t("CULPRIT")}</small>}</span><div><span style={{ width: `${((room.result?.tallies[person.id] ?? 0) / Math.max(1, room.players.length)) * 100}%` }} /></div><strong>{room.result?.tallies[person.id] ?? 0}</strong></div>)}</section><PublicEvidence room={room} /><AnswerFeedback room={room} final /><p className="phone-action-hint">{t("Your host can deal a new mystery. Same town, new secrets.")}</p></>}
      {room.rehearsal && room.phase === 'voting' && room.players.length < 2 && <p className="phone-notice">{t("Solo rehearsal: there is no other suspect to accuse. Use Next step on the developer screen to reveal the ending, or add sample players in the next lobby to test voting.")}</p>}<PlayerRecovery room={room} connected={connected} onMasterSession={onMasterSession ?? (() => {})} onReleased={onReleased ?? onLeave}/><details className="phone-accordion phone-rules"><summary>{t("Quick rules")}<CircleHelp size={18} /></summary><div className="phone-evidence-body"><p><strong>{t(room.rehearsal ? "Developer rehearsal · 1–20 test players." : "4–20 guests + one separate game master.")}</strong> {t("Stay in character, compare stories, and let everyone join the conversation.")}</p><p>{t("Each act: search one location (+25), share assigned clues (+25 each), answer one case question (+100 if correct), and update your anonymous suspicion.")}</p><p>{t("Case answers lock as soon as you tap; feedback arrives when the act closes. The host controls the timer and phase changes.")}</p><p>{t("Final accusation: choose a suspect and confirm once. A correct accusation earns 200 points. The culprit earns 200 if they escape. Scores are party awards; evidence solves the case.")}</p><p>{t("Read your own private file discreetly. Roleplay the mystery; keep real-life boundaries comfortable.")}</p></div></details>
      <footer className="phone-footer"><span>{t("KEEP YOUR SECRETS CLOSE.")}</span><strong>ALIBI ★</strong></footer>
    </main>
    <div className="phone-feedback-live" aria-live="polite" aria-atomic="true">{success && <div className="phone-action-success" key={success.key}><CheckCheck size={21}/><span>{t(success.message)}</span></div>}</div>
    {transition && <div className="phone-round-transition" key={transition.key} role="status" aria-live="polite" aria-atomic="true"><div className="phone-transition-star" aria-hidden="true">✦</div><div className="phone-transition-copy"><span className="phone-kicker">DUSTFALL ★</span><strong>{t(transition.title, { round: transition.round })}</strong><p>{t(transition.description)}</p></div><div className="phone-transition-line" aria-hidden="true"/></div>}
    {(confirmation && selectedPlayer || leaving) && <div className="phone-modal-backdrop" onClick={() => { if (!pendingRef.current) { setConfirmation(false); setLeaving(false); } }}><section ref={dialogRef} className="phone-modal" role="dialog" aria-modal="true" aria-labelledby="phone-dialog-title" onClick={event => event.stopPropagation()}><div className="phone-modal-top"><span className="phone-kicker">{leaving ? t("LEAVING DUSTFALL?") : t("THE POINT OF NO RETURN")}</span><button className="phone-icon-button" aria-label={leaving ? t("Keep playing") : t("Cancel accusation")} disabled={!!pending} onClick={() => { setConfirmation(false); setLeaving(false); }}><X size={22} /></button></div><h2 id="phone-dialog-title">{leaving ? t("Step away from the table?") : t("Accuse {name}?", { name: selectedPlayer?.name ?? '' })}</h2><p>{leaving ? t("Your seat stays saved. Reopen your player link to return.") : t("Once you file this accusation, your vote is locked. Make it count.")}</p>{error && <div className="join-error" role="alert">{t(error)}</div>}<button className="phone-button" disabled={leaving ? !!pending : disabled} onClick={() => leaving ? onLeave() : selectedPlayer && void act({ type: 'vote', playerId: selectedPlayer.id }, 'vote')}>{leaving ? t("Step away") : pending === 'vote' ? t("Filing accusation…") : t("Yes, seal my vote")}<LockKeyhole size={19} /></button><button className="phone-modal-cancel" disabled={!!pending} onClick={() => { setConfirmation(false); setLeaving(false); }}>{leaving ? t("Keep playing") : t("I need to think")}</button></section></div>}
  </div>;
}
