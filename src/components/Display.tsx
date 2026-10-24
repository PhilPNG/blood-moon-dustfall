import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, LockKeyhole, Maximize2, Minimize2, Pause, Radio, Search, ShieldCheck, Smartphone, Trophy, Users, Volume2, VolumeX, WifiOff } from 'lucide-react';
import type { DisplayCapability, MediaPlaybackReport, PairingTicket, PlayerView, RoomView } from '../../shared/types';
import { request, RpcError } from '../client';
import { GameMasterStatus } from './RoomRecovery';
import { Clock } from './Clock';
import { CinematicPlayer } from './CinematicPlayer';
import { CharacterPortrait, DustfallLogo, EvidenceArt, playerCharacter, PublicSeal, StageArt } from './GameArt';
import { attentionEventKey } from '../../shared/attention';
import { useAttentionCountdown } from '../useAttentionCountdown';
import { attentionRequestPayload, withAttentionReceipt, type AttentionReceipt, type AttentionRequester } from './media-attention';
import { displayLease } from './display-lease';
import { useStageMusic } from './useStageMusic';
import { DistanceInvestigation, StagePreflightStatus, StageSpotlight } from './StagePresentation';
import { spotlightEvidence } from '../../shared/stage-presentation';
import { publicEvidence } from '../../shared/evidence-browser';
import { useLanguage } from '../i18n';
import { stageCopy } from './stage-translations';
import { FunAwards } from './FunAwards';

type DisplayProps = { room: RoomView; connected: boolean; joinOrigin: string; pairing?: PairingTicket; developerControls?: boolean };
type Evidence = { id: string; title: string; text: string; source: string };

function useDisplayPlayback(room: RoomView, connected: boolean, visible: boolean) {
  const code = room.code;
  const currentRoom = useRef(room); currentRoom.current = room;
  const capability = useRef<DisplayCapability | undefined>(undefined);
  const [leader, setLeader] = useState(false);
  const [lease] = useState(() => displayLease(setLeader));
  const [displayId] = useState(() => typeof crypto !== 'undefined' ? crypto.randomUUID() : 'server-render');
  const sequence = useRef(0), lastAccepted = useRef(0), inFlight = useRef(false);
  const pending = useRef<MediaPlaybackReport | null>(null);
  const latestSample = useRef<MediaPlaybackReport | null>(null);
  const unavailableSent = useRef(false);
  const available = useRef(connected && visible);
  available.current = connected && visible;
  useEffect(() => {
    let disposed = false, claiming = false;
    capability.current = undefined;
    const claim = async () => {
      if (disposed || claiming || !available.current || Date.now() - lastAccepted.current < 3000) return;
      claiming = true;
      const startedAt = performance.now();
      try {
        const current = capability.current;
        const result = await request<DisplayCapability>('room:display-claim', { code, displayId, ...(current?.token ? { token: current.token } : {}) });
        if (!disposed) { capability.current = result.active ? result : undefined; if (result.active) lease.renew(startedAt); else lease.revoke(); }
      } catch { /* Public display and films stay usable when caption sync is unavailable. */ }
      finally { claiming = false; }
    };
    void claim();
    const interval = window.setInterval(() => void claim(), 4000);
    const stop = () => {
      const cap = capability.current, sample = latestSample.current;
      if (!cap?.token || !sample) return;
      const element = document.querySelector<HTMLMediaElement>(sample.kind === 'film' ? 'video' : 'audio');
      const playback = { ...sample, position: element && Number.isFinite(element.currentTime) ? element.currentTime : sample.position, playing: false };
      const body = JSON.stringify({ event: 'room:playback', payload: { code, displayId, token: cap.token, sequence: ++sequence.current, playback }, requestId: crypto.randomUUID() });
      if (typeof navigator.sendBeacon === 'function') navigator.sendBeacon('/api/rpc', new Blob([body], { type: 'application/json' }));
      else void fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    };
    window.addEventListener('pagehide', stop);
    return () => { stop(); disposed = true; capability.current = undefined; pending.current = null; lease.revoke(); window.clearInterval(interval); window.removeEventListener('pagehide', stop); };
  }, [code, displayId, lease]);
  const reportPlayback = useCallback((sample: MediaPlaybackReport) => {
    if (!available.current && unavailableSent.current) return;
    unavailableSent.current = !available.current;
    latestSample.current = sample;
    pending.current = { ...sample, playing: sample.playing && available.current };
    const drain = async () => {
      if (currentRoom.current.code !== code || inFlight.current || !capability.current?.token || !pending.current) return;
      const playback = pending.current, cap = capability.current;
      pending.current = null; inFlight.current = true;
      const startedAt = performance.now();
      try {
        await request<{ accepted: true }>('room:playback', { code, displayId, token: cap.token, sequence: ++sequence.current, playback });
        if (currentRoom.current.code === code) { lastAccepted.current = Date.now(); lease.renew(startedAt); }
      } catch (cause) {
        if (cause instanceof RpcError && !cause.network && /display capability/i.test(cause.message)) { capability.current = undefined; lease.revoke(); }
      } finally { inFlight.current = false; if (pending.current) void drain(); }
    };
    void drain();
  }, [code, displayId, lease]);
  const requestAttention: AttentionRequester = useCallback(async (cue, clueId) => {
    const cap = capability.current, observed = currentRoom.current;
    if (!available.current || !cap?.token) return null;
    const eventKey = attentionEventKey(observed);
    const receipt = await request<AttentionReceipt>('room:attention', attentionRequestPayload(observed, displayId, cap.token, cue, clueId));
    if (!available.current || currentRoom.current.code !== code || attentionEventKey(currentRoom.current) !== eventKey) return null;
    return receipt;
  }, [code, displayId]);
  return { reportPlayback, requestAttention, leader: leader && connected && visible };
}

function useArcadeSound(eventKey: string, blocked: boolean) {
  const [enabled, setEnabled] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef(eventKey);
  const interrupted = useRef(blocked); interrupted.current = blocked;
  const play = useCallback((frequencies: number[]) => {
    const context = audio.current;
    if (!context || context.state !== 'running' || interrupted.current) return;
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * .09;
      oscillator.type = 'triangle'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.045, start + .01); gain.gain.exponentialRampToValueAtTime(.001, start + .22);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + .24);
    });
  }, []);
  useEffect(() => {
    if (blocked || previous.current === eventKey) return;
    const phaseChanged = previous.current.split('|')[0] !== eventKey.split('|')[0];
    previous.current = eventKey;
    if (enabled) play(phaseChanged ? [220, 330, 440, 660] : [660, 880]);
  }, [eventKey, enabled, play, blocked]);
  useEffect(() => () => { void audio.current?.close(); }, []);
  const toggle = async () => {
    if (enabled) { setEnabled(false); return; }
    try { audio.current ||= new AudioContext(); await audio.current.resume(); setEnabled(true); play([330, 440, 660]); }
    catch { setEnabled(false); }
  };
  return { enabled, toggle, context: audio.current };
}

export function Display({ room: incomingRoom, connected, joinOrigin, pairing, developerControls = false }: DisplayProps) {
  const { language } = useLanguage(), labels = stageCopy[language];
  const [full, setFull] = useState(false), [error, setError] = useState('');
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const { reportPlayback, requestAttention: claimAttention, leader } = useDisplayPlayback(incomingRoom, connected, visible);
  const [presentationBusy, setPresentationBusy] = useState(false);
  const [attentionReceipt, setAttentionReceipt] = useState<AttentionReceipt | null>(null);
  const room = withAttentionReceipt(incomingRoom, attentionReceipt);
  const requestAttention: AttentionRequester = useCallback(async (cue, clueId) => {
    const receipt = await claimAttention(cue, clueId);
    if (receipt) setAttentionReceipt(previous => !previous || previous.attention.eventKey !== receipt.attention.eventKey || previous.attention.id <= receipt.attention.id ? receipt : previous);
    return receipt;
  }, [claimAttention]);
  const attentionBlocked = useAttentionCountdown(room) > 0;
  const sceneKey = `${room.gameId ?? room.code}:${room.phase}:${room.round}`;
  const { enabled: sound, toggle: toggleSound, context: soundContext } = useArcadeSound(`${sceneKey}|${room.attention?.id ?? ''}`, attentionBlocked || !connected || !visible);
  const musicLevel = useStageMusic(soundContext, room, { sound, leader, connected, visible, mediaBusy: presentationBusy, attention: attentionBlocked, preflight: room.phase === 'lobby' && !!room.preflight && !room.preflight.completed && presentationBusy });
  const spotlight = spotlightEvidence(room, presentationBusy || attentionBlocked);
  useEffect(() => {
    const update = () => setFull(Boolean(document.fullscreenElement));
    update(); document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const fullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); setError(''); }
    catch { setError('Use your browser’s full screen option to expand this display.'); }
  };
  const tools = <div className="stage-tools"><button onClick={toggleSound} aria-label={sound ? 'Mute game and film sound' : 'Enable game and film sound'} aria-pressed={sound} title={sound ? 'Sound on' : 'Sound off'}>{sound ? <Volume2/> : <VolumeX/>}</button><button aria-label={full ? 'Exit full screen' : 'Enter full screen'} onClick={fullscreen}>{full ? <Minimize2/> : <Maximize2/>}</button></div>;
  if (room.masterReady === false) return <PairingDisplay room={room} connected={connected} joinOrigin={joinOrigin} pairing={pairing} tools={tools} error={error}/>;
  return <div className={`dustfall-stage stage-${room.phase}${room.stageSettings?.distanceMode ? ' stage-distance' : ''}`} data-verdict={room.phase === 'results' ? room.result?.caught ? 'caught' : 'escaped' : undefined}>
    <StageArt/>
    <header className="stage-hud"><a className="stage-home" href="/" aria-label="Dustfall home"><DustfallLogo/></a><div className="stage-room-hud">{room.rehearsal && <b className="stage-rehearsal-badge">REHEARSAL</b>}<span>Room <strong>{room.code}</strong></span><i/><span>{room.phase === 'investigation' ? <>Act <strong>{String(room.round).padStart(2, '0')}</strong> of <strong>{String(room.settings.rounds).padStart(2, '0')}</strong></> : room.phase === 'lobby' ? 'A Halloween murder mystery' : room.phase === 'roles' ? 'The secret identities' : room.phase === 'voting' ? 'Final accusation' : 'The truth is out'}</span></div>{room.phase === 'investigation' ? <div className="stage-clock" aria-label="Time remaining"><Clock timer={room.timer} serverNow={room.serverNow}/></div> : <div className={`stage-live${!connected ? ' is-offline' : ''}`}><i/>{connected ? 'Live' : 'Offline'} <b>{room.players.length}<small> / {room.settings.maxPlayers}</small></b></div>}</header>
    {error && <p className="stage-notice" role="status">{error}</p>}
    <CinematicPlayer room={room} connected={connected && visible} sound={sound} toggleSound={toggleSound} onPlayback={reportPlayback} onAttention={requestAttention} onBusyChange={setPresentationBusy} mediaLeader={leader} embeddedControls={developerControls}>{concealResults => <>
      {spotlight ? <StageSpotlight room={room} blocked={presentationBusy || attentionBlocked}/> : room.phase === 'lobby' ? <><Lobby room={room} joinOrigin={joinOrigin}/><StagePreflightStatus room={room}/></> : room.phase === 'roles' ? <Roles room={room}/> : room.phase === 'investigation' ? room.stageSettings?.distanceMode ? <DistanceInvestigation room={room} blocked={presentationBusy || attentionBlocked || !connected || !visible}/> : <Investigation room={room}/> : room.phase === 'voting' ? <Voting room={room}/> : concealResults ? <main className="stage-verdict-wait" aria-label="The verdict"><span className="stage-kicker">The sealed accusations are in</span><h1>The truth is coming.</h1></main> : !presentationBusy && !attentionBlocked && (room.partyAwards?.status === 'voting' || room.partyAwards?.status === 'revealed') ? <main className="stage-party-awards-layout"><FunAwards room={{ ...room, isMaster: false, me: undefined }} connected={connected} variant="host"/><details className="stage-verdict-review"><summary>{labels.reviewVerdict}</summary><Results room={room} embedded/></details></main> : <Results room={room}/>}
      {room.phase === 'results' && !concealResults && <div className="stage-confetti" key={`${room.gameId ?? room.code}-results`} aria-hidden="true">{Array.from({ length: 26 }, (_, i) => <i key={i} style={{ '--piece': i } as CSSProperties}/>)}</div>}
    </>}</CinematicPlayer>
    <footer className="stage-footer"><span>✦</span><Smartphone size={23}/><div className="stage-footer-copy"><p>{room.phase === 'lobby' ? developerControls ? 'Test controls above · your character stays on your phone' : 'Game master controls the show from their phone' : room.phase === 'investigation' ? 'Search. Share. Question everything.' : room.phase === 'voting' ? 'One shot. Make it count.' : room.phase === 'roles' ? 'Keep your secrets close. Get ready on your phone.' : 'Every suspect has a story. Now you know the truth.'}</p><GameMasterStatus room={room}/>{room.stageSettings?.musicEnabled && <p className="stage-music-status" data-music={musicLevel > 0 ? presentationBusy ? 'ducked' : 'playing' : 'holding'}>{!sound ? labels.musicUnlock : !leader ? labels.musicSecondary : presentationBusy && musicLevel > 0 ? labels.musicQuiet : labels.music}</p>}</div><span>✦</span>{tools}</footer>
    {(!connected || room.timer.isPaused) && <div className="stage-interruption" role="status"><div>{!connected ? <WifiOff size={40}/> : <Pause size={40}/>}<h2>{!connected ? 'Restoring the signal' : 'Hold your horses'}</h2><p>{!connected ? 'Reconnecting to Dustfall. Keep this screen open.' : room.phase === 'results' ? 'The game master paused the ending presentation. It will resume shortly.' : 'The game master paused the clock. The investigation will resume shortly.'}</p></div></div>}
  </div>;
}

function Lobby({ room, joinOrigin }: { room: RoomView; joinOrigin: string }) {
  const origin = joinOrigin.replace(/\/$/, '');
  return <main className="stage-lobby-layout">
    <section className="stage-lobby-hero"><div className="stage-lobby-title"><span className="stage-kicker">✦ Alibi party arcade ✦</span><DustfallLogo large/><p>Cowboys <span>vs</span> Aliens</p><small>A peace treaty. A stolen core.<br/>One killer under the blood moon.</small></div><section className="stage-ticket" aria-label="Join this game"><h1>Join on your phone</h1><strong className="stage-code">{room.code}</strong><div className="stage-ticket-join"><QRCodeSVG value={`${origin}/join/${room.code}`} size={185} level="M" marginSize={2} title={`Join Dustfall room ${room.code}`}/><div><Smartphone size={34}/><b>Scan the<br/>QR code</b><span>or open</span><a href={`${origin}/join/${room.code}`}>{origin.replace(/^https?:\/\//, '')}</a></div></div><p>{room.rehearsal ? '1–20 test players · rehearsal mode' : '4–20 suspects + 1 game master'}</p><span className="stage-ticket-stars">✦ ━━━ ✦ ━━━ ✦</span></section></section>
    <section className="stage-lobby-roster" aria-labelledby="roster-title"><div className="stage-section-line"><h2 id="roster-title"><Users size={18}/> The suspects are gathering</h2><span>{room.players.length} of {room.settings.maxPlayers} in town</span></div><div className={`stage-roster${room.players.length > 10 ? ' stage-roster-full' : ''}`} style={{ '--cast-size': Math.max(4, Math.min(10, room.players.length || 4)) } as CSSProperties}>{room.players.length ? room.players.map((player, i) => <CastCard key={player.id} player={player} index={i} lobby/>) : <div className="stage-empty-roster"><span>✦</span> Your story starts with a scan. Be the first suspect in Dustfall. <span>✦</span></div>}</div><p className="stage-placeholder-note">Character portraits are a preview. Your private identity is dealt when the game begins.</p></section>
  </main>;
}
function CastCard({ player, index, lobby = false, ready = false, sealed = false }: { player: PlayerView; index: number; lobby?: boolean; ready?: boolean; sealed?: boolean }) {
  const character = playerCharacter(lobby ? { ...player, characterId: undefined, roleName: undefined } : player, index);
  return <article className={`stage-cast-card${ready && player.ready ? ' is-ready' : ''}${sealed && player.hasVoted ? ' has-sealed-vote' : ''}`} style={{ '--cast-color': character.color, '--arrival': Math.min(index, 9) } as CSSProperties}><span className="stage-seat">{String(index + 1).padStart(2, '0')}</span><CharacterPortrait character={character} decorative/><div className="stage-cast-name"><h3>{player.name}</h3>{!lobby && <><span>{player.roleName || character.name}</span><PublicSeal characterId={character.id}/></>}{ready && <b>{player.ready ? <><Check size={15}/> Ready</> : 'Reading their role'}</b>}{sealed && <b className="stage-voter-status">{player.hasVoted ? <><Check size={15}/> Accusation sealed</> : 'Still deciding'}</b>}</div><span className={`stage-phone-dot${player.connected ? ' connected' : ''}`} title={player.connected ? 'Phone connected' : 'Phone disconnected'}/></article>;
}
function Roles({ room }: { room: RoomView }) {
  const ready = room.players.filter(player => player.ready).length;
  return <main className="stage-roles-layout"><div className="stage-scene-heading"><span className="stage-kicker">Your stories begin on your phones</span><h1>New faces.<br/><em>Big secrets.</em></h1><p>Read your private dossier. Become your character.<br/>Then tap <strong>I’m ready</strong> on your phone.</p><div className="stage-ready-count"><Check/><strong>{ready} <small>/ {room.players.length}</small></strong><span>suspects ready</span></div></div><section className="stage-identity-wall" aria-label="The cast"><div className={`stage-identity-grid${room.players.length > 10 ? ' is-full-cast' : ''}`}>{room.players.map((player, i) => <CastCard key={player.id} player={player} index={i} ready/>)}</div></section></main>;
}
function evidenceFor(room: RoomView): Evidence[] {
  return publicEvidence(room).map(item => ({ id: item.key, title: item.title, text: item.text, source: item.kind === 'case' ? 'Case evidence' : `Act ${item.round} · ${item.playerName}` }));
}
function Investigation({ room }: { room: RoomView }) {
  const evidence = evidenceFor(room), latest = evidence.at(-1);
  const [selected, setSelected] = useState(room.act?.evidence.at(-1) ? `case:${room.act.evidence.at(-1)!.id}` : latest?.id || '');
  const [rotating, setRotating] = useState(true);
  const seenEvidence = useRef(new Set(evidence.map(clue => clue.id)));
  const evidenceKey = evidence.map(clue => clue.id).join(',');
  useEffect(() => {
    const newlyFound = evidence.filter(clue => !seenEvidence.current.has(clue.id));
    seenEvidence.current = new Set(evidence.map(clue => clue.id));
    if (newlyFound.length) setSelected(newlyFound.at(-1)!.id);
  }, [evidenceKey]);
  useEffect(() => {
    if (!rotating || !evidence.length || room.timer.isPaused) return;
    const ids = evidence.map(clue => clue.id);
    const interval = window.setInterval(() => setSelected(current => ids[(ids.indexOf(current) + 1) % ids.length]), 18000);
    return () => window.clearInterval(interval);
  }, [evidenceKey, rotating, room.timer.isPaused]);
  const featured = evidence.find(clue => clue.id === selected) || latest;
  const actTitle = room.act?.title.replace(/^Act [IVX\d]+\s*[·:—–-]\s*/i, '') || 'Follow the Evidence';
  return <main className="stage-investigation-layout">
    <section className="stage-act-copy"><span className="stage-kicker">The investigation / act {room.round}</span><h1 key={`${room.code}-${room.round}`}>{actTitle}</h1><span className="stage-act-tagline">Follow the signal.</span><details className="stage-act-narration"><summary>Read the story so far</summary><p>{room.act?.narration || 'Compare your clues. Question alibis. Every secret has a story.'}</p></details><div className="stage-discuss"><span>✦ Discuss together</span><p>{room.act?.prompt || 'Compare the evidence and share your theories.'}</p></div></section>
    <section className="stage-evidence-hero" aria-label="Selected evidence">{featured ? <article className="stage-evidence-paper" key={featured.id}><span className="stage-evidence-tape">Evidence found</span><EvidenceArt text={`${featured.title} ${featured.text}`}/><span className="stage-paper-source">{featured.source}</span><h2>{featured.title}</h2><p>{featured.text}</p><span className="stage-paper-flourish">━━━━ ✦ ━━━━</span></article> : <div className="stage-evidence-paper stage-no-evidence"><Search size={72}/><h2>The truth is out there.</h2><p>Search a location and share your clue from your phone. Public evidence will appear here.</p></div>}</section>
    <section className="stage-evidence-rail"><div className="stage-section-line"><h2>Public evidence</h2><span>{evidence.length} found</span></div><div className="stage-evidence-scroll" tabIndex={0} aria-label="All public evidence">{evidence.map((clue, i) => <button className={`stage-evidence-item${featured?.id === clue.id ? ' is-selected' : ''}`} key={clue.id} aria-pressed={featured?.id === clue.id} onClick={() => { setSelected(clue.id); setRotating(false); }}><EvidenceArt text={`${clue.title} ${clue.text}`} small/><span><small>{clue.source}</small><strong>{clue.title}</strong><p>{clue.text}</p></span><b>{String(i + 1).padStart(2, '0')}</b></button>)}{!evidence.length && <p className="stage-empty-copy">Shared evidence appears here. Keep searching.</p>}</div><button className="stage-rotation-toggle" onClick={() => setRotating(value => !value)} aria-pressed={rotating}>{rotating ? 'Ⅱ Pause evidence rotation' : '▶ Resume evidence rotation'}</button>{room.act?.question && <section className="stage-public-question"><span className="stage-kicker">Case question · answer on your phone</span><h2>{room.act.question.prompt}</h2><ol>{room.act.question.options.map((option, i) => <li key={option.id}><b>{String.fromCharCode(65 + i)}</b>{option.text}</li>)}</ol></section>}</section>
    <section className="stage-suspicion"><div className="stage-section-line"><h2>Anonymous suspicion</h2><span>Live theories · not final accusations</span></div><div className="stage-suspect-scroll" tabIndex={0} aria-label="Current anonymous suspicion"><div className={`stage-suspect-grid${room.players.length > 10 ? ' is-full-cast' : ''}`}>{room.players.map((player, i) => {
      const character = playerCharacter(player, i), votes = room.suspicions?.[player.id] || 0;
      return <article className="stage-suspect" key={player.id} style={{ '--cast-color': character.color } as CSSProperties}><CharacterPortrait character={character} decorative/><div><h3>{player.name}</h3><span>{player.roleName || character.name}</span><PublicSeal characterId={character.id}/><div className="stage-suspicion-track"><i style={{ width: `${100 * votes / Math.max(1, room.players.length)}%` }}/></div></div><strong>{votes}<small>{votes === 1 ? 'signal' : 'signals'}</small></strong></article>;
    })}</div></div></section>
    <section className="stage-phone-signals"><div className="stage-section-line"><h2><Radio size={20}/> Live phone signals</h2></div><div className="stage-signal-counts"><div><Search/><strong>{room.searchCount || 0}</strong><span>searched</span></div><i/><div><ShieldCheck/><strong>{room.answerCount || 0}</strong><span>answered</span></div></div><span>of {room.players.length} suspects this act</span></section>
    {room.questionResult && <details className="stage-question-resolution"><summary>Previous act’s answer · Act {room.questionResult.round}</summary><p>{room.questionResult.explanation}</p></details>}
  </main>;
}
function Voting({ room }: { room: RoomView }) {
  return <main className="stage-voting-layout"><div className="stage-voting-title"><span className="stage-kicker">The final accusation</span><h1>Draw your<br className="stage-mobile-break"/> conclusions</h1><p>Who killed Mayor Graves?</p><span className="stage-voting-seal-hint">Match the color and symbol on each public admission seal.</span></div><section className={`stage-voting-grid${room.players.length > 10 ? ' is-full-cast' : ''}`} aria-label="The suspects">{room.players.map((player, i) => <CastCard key={player.id} player={player} index={i} sealed/>)}</section><div className="stage-sealed-progress"><div className="stage-vote-phone"><Smartphone/><strong>Vote on<br/>your phone</strong></div><div className="stage-sealed-meter" role="progressbar" aria-label="Accusations sealed" aria-valuenow={room.votesCount} aria-valuemin={0} aria-valuemax={room.players.length}>{room.players.map((player, i) => <i key={player.id} className={i < room.votesCount ? 'is-sealed' : ''}/>)}</div><div className="stage-sealed-total"><strong key={room.votesCount}>{room.votesCount}<small> / {room.players.length}</small></strong><span>accusations sealed</span></div><span className="stage-voting-stamp"><LockKeyhole size={21}/> Your vote<br/>stays secret</span></div><details className="stage-voting-evidence"><summary>Review the public evidence before you accuse</summary><div>{evidenceFor(room).map(clue => <article key={clue.id}><span>{clue.source}</span><h3>{clue.title}</h3><p>{clue.text}</p></article>)}</div></details></main>;
}
function Results({ room, embedded = false }: { room: RoomView; embedded?: boolean }) {
  const Container = embedded ? 'section' : 'main';
  const result = room.result, culprit = room.players.find(player => player.id === result?.culpritId);
  const character = culprit ? playerCharacter(culprit) : undefined;
  const tallies = [...room.players].sort((a, b) => (result?.tallies[b.id] || 0) - (result?.tallies[a.id] || 0));
  const scores = [...(result?.scores || [])].sort((a, b) => b.score - a.score), podium = scores.slice(0, 3);
  const maxTally = Math.max(1, ...Object.values(result?.tallies || {}));
  return <Container className="stage-results-layout"><div className="stage-result-title"><h1>{result?.caught ? 'Case closed' : 'A clean getaway'}</h1><p>{result?.caught ? 'The town caught the culprit' : 'The culprit escaped the town’s accusation'}</p></div><section className="stage-culprit-card" aria-label="Culprit revealed">{character && <CharacterPortrait character={character}/>}<span className="stage-culprit-stamp">Culprit</span><div><span>The truth behind Black Star</span><h2>{culprit?.name || 'The culprit'}</h2><p>{culprit?.roleName || character?.name}</p><small>{character?.title}</small></div></section><section className="stage-final-tallies"><div className="stage-section-line"><h2>The accusations</h2><span>All {room.players.length} suspects</span></div><div className="stage-tally-scroll" tabIndex={0} aria-label="All final accusation totals">{tallies.map((player, i) => { const votes = result?.tallies[player.id] || 0, profile = playerCharacter(player, i); return <article className={`stage-tally-row${player.id === culprit?.id ? ' is-culprit' : ''}`} data-vote-row={player.id} key={player.id} style={{ '--cast-color': profile.color } as CSSProperties}><CharacterPortrait character={profile} decorative/><div><h3>{player.name}</h3><span>{player.roleName || profile.name}</span><div className="stage-tally-track"><i style={{ width: `${100 * votes / maxTally}%` }}/></div></div><strong>{votes}<small>{votes === 1 ? 'vote' : 'votes'}</small></strong>{player.id === culprit?.id && <b>Culprit</b>}</article>; })}</div></section><section className="stage-awards"><div className="stage-section-line"><h2><Trophy size={20}/> Dustfall’s finest</h2></div>{podium.length ? <div className="stage-podium">{podium.map((score, index) => { const player = room.players.find(player => player.id === score.playerId); if (!player) return null; return <article className={`stage-podium-place place-${index + 1}`} key={score.playerId}><CharacterPortrait character={playerCharacter(player, index)} decorative/><span>★<b>{index + 1}</b></span><div><h3>{player.name}</h3><strong>{score.score}</strong><small>points</small></div></article>; })}</div> : <div className="stage-awards-empty"><Trophy size={50}/><h3>Legends of Dustfall</h3><p>A mystery is best solved together.</p></div>}<span className="stage-awards-note">Searches · shared clues · case answers · final accusation</span></section>
    <section className="stage-case-file"><div className="stage-case-summary"><span className="stage-kicker">The complete case file</span><h2>{result?.solution?.headline || 'The truth comes out'}</h2><p>{result?.solution?.summary || `${culprit?.name || 'The culprit'} was behind the crime in Dustfall.`}</p>{result?.solution && <div className="stage-method-motive"><article><h3>The method</h3><p>{result.solution.method}</p></article><article><h3>The motive</h3><p>{result.solution.motive}</p></article></div>}</div>{result?.solution?.timeline && <ol className="stage-case-timeline">{result.solution.timeline.map((event, index) => <li key={`${event.time}-${index}`}><span>✦</span><strong>{event.time}</strong><p>{event.text}</p></li>)}</ol>}</section>
    {!!scores.length && <section className="stage-full-scores"><div className="stage-section-line"><h2>Every legend. Every point.</h2><span>Full party awards</span></div><div className="stage-score-grid">{scores.map((score, index) => { const player = room.players.find(player => player.id === score.playerId); return <article key={score.playerId} data-score-row={score.playerId}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{player?.name || 'Guest'}</h3><p>{score.searches} searches · {score.cluesShared} shared · {score.correctAnswers} correct{score.correctAccusation ? ' · correct accusation' : ''}</p></div><strong>{score.score}<small>pts</small></strong></article>; })}</div></section>}
  </Container>;
}
function PairingDisplay({ room, connected, joinOrigin, pairing, tools, error }: { room: RoomView; connected: boolean; joinOrigin: string; pairing?: PairingTicket; tools: ReactNode; error: string }) {
  const [now, setNow] = useState(Date.now()), [copied, setCopied] = useState(false), [copyError, setCopyError] = useState('');
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, []);
  const valid = pairing?.code === room.code && pairing.expiresAt > now;
  const pairUrl = valid ? `${joinOrigin.replace(/\/$/, '')}/host/${room.code}#ticket=${encodeURIComponent(pairing.ticket)}` : '';
  async function copy() {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(pairUrl);
      else { const field = document.createElement('textarea'); field.value = pairUrl; field.style.position = 'fixed'; field.style.opacity = '0'; document.body.appendChild(field); field.select(); const success = document.execCommand('copy'); field.remove(); if (!success) throw new Error(); }
      setCopied(true); setCopyError('');
    } catch { setCopyError('Select the link below and copy it to your phone.'); }
  }
  return <div className="dustfall-stage stage-pairing"><StageArt/><header className="stage-hud"><a href="/" className="stage-home" aria-label="Dustfall home"><DustfallLogo/></a><div className="stage-room-hud">The night begins on your phone</div><div className="stage-live"><i/>{connected ? 'Room ready' : 'Reconnecting'}</div></header>{(!connected || error) && <p className="stage-notice" role="status">{error || 'Reconnecting to your room. Keep this display open.'}</p>}<main className="stage-pairing-main"><section className="stage-pairing-copy"><span className="stage-kicker">Room {room.code} / The shared screen</span><h1>Run the show.<br/><em>From your phone.</em></h1><p>This computer is the shared screen. The game master runs the night from private phone controls.</p><ol><li><Smartphone/><span>Scan with the game master’s phone</span></li><li><LockKeyhole/><span>Keep the controls on that phone</span></li><li><Users/><span>Invite your suspects once paired</span></li></ol></section><section className="stage-ticket stage-pair-ticket" aria-labelledby="pairing-title">{pairUrl ? <><span className="stage-kicker">One phone. One game master.</span><h2 id="pairing-title">Game master QR</h2><p>Scan for private phone controls</p><div className="stage-pair-qr"><QRCodeSVG value={pairUrl} size={260} level="M" marginSize={2} title={`Game master pairing for Dustfall room ${room.code}`}/></div><p>One use · expires in {Math.max(1, Math.ceil((pairing!.expiresAt - now) / 60000))} min</p><button className="stage-copy-link" onClick={copy}>{copied ? <Check size={18}/> : <Copy size={18}/>} {copied ? 'Phone link copied' : 'Copy phone link'}</button><details className="stage-pair-link"><summary>Can’t scan? Copy the link to your phone</summary><span>{pairUrl}</span></details>{copyError && <p role="status">{copyError}</p>}</> : <><Smartphone size={56}/><h2 id="pairing-title">{pairing ? 'This pairing link has expired.' : 'Waiting for the game master'}</h2><p>{pairing ? 'Return home and create a new room to get a fresh phone pairing QR.' : 'Open the original pairing screen on the computer that created this room, then scan its game master QR with your phone.'}</p>{pairing && <a className="stage-copy-link" href="/">Back home</a>}</>}</section></main><footer className="stage-footer"><LockKeyhole size={20}/><p>Private controls on the game master’s phone</p>{tools}</footer></div>;
}
