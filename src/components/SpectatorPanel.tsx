import { ArrowRight, Home, Radio, Users } from 'lucide-react';
import type { RoomView } from '../../shared/types';
import { LanguageMenu } from '../i18n';
import { usePartyLanguage } from '../party-translations';
import { useAttentionCountdown } from '../useAttentionCountdown';
import { AttentionOverlay } from './AttentionOverlay';
import { PhoneCaptions } from './PhoneCaptions';
import { PublicEvidence } from './PublicEvidence';
import { GameMasterStatus } from './RoomRecovery';
import { Clock } from './Clock';
import { FunAwards } from './FunAwards';

const phaseGuides = {
  lobby: 'The table is gathering. Share the player QR with anyone who wants a character.',
  roles: 'Players are reading their private character dossiers.',
  investigation: 'Compare the public clues and follow the discussion.',
  voting: 'Accusations are sealed. The live count shows participation only.',
  results: 'The verdict is public. Celebrate the cast and follow the reconstruction.',
};
export function SpectatorPanel({ room, connected, onJoin, onHome }: { room: RoomView; connected: boolean; onJoin: () => void; onHome: () => void }) {
  const { t, language } = usePartyLanguage();
  // Public-only children cannot inherit a saved player/GM identity from a caller.
  const publicRoom = { ...room, me: undefined, isMaster: false };
  const countdown = useAttentionCountdown(publicRoom);
  const canJoin = room.phase === 'lobby' && !room.isLocked && room.players.length < room.settings.maxPlayers;
  const culprit = room.phase === 'results' ? room.players.find(player => player.id === room.result?.culpritId) : undefined;
  return <div className="phone-page party-spectator" lang={language}>
    <AttentionOverlay room={publicRoom} connected={connected}/>
    <div inert={countdown > 0 || undefined} aria-hidden={countdown > 0 || undefined}>
      <header className="phone-header"><button className="phone-icon-button" type="button" aria-label={t('Back to Dustfall')} onClick={onHome}><Home size={20}/></button><span className="phone-brand">ALIBI<span>★</span></span><LanguageMenu/></header>
      <main className="phone-main">
        <span className="phone-kicker"><Radio size={15}/>{t('Audience mode')} · {room.code}</span>
        <h1 className="phone-screen-title">{t('Follow the mystery')}</h1>
        <p>{t('Public clues and live captions. No character, secret file or vote on this phone.')}</p>
        {!connected && <p className="phone-notice" role="status">{t('Reconnecting')}</p>}
        <GameMasterStatus room={publicRoom}/>
        <section className="party-card party-audience-guide"><p>{t(phaseGuides[room.phase])}</p>{room.phase === 'investigation' && <><h2>{room.act?.title ?? t('ACT {round}', { round: room.round })}</h2><Clock timer={room.timer} serverNow={room.serverNow}/>{room.act?.prompt && <p>{room.act.prompt}</p>}</>}{culprit && <h2>{t('The culprit was {name}', { name: culprit.name })}</h2>}</section>
        <PhoneCaptions room={publicRoom} connected={connected}/>
        <PublicEvidence room={publicRoom}/>
        <FunAwards room={publicRoom} connected={connected}/>
        <section className="party-card party-audience-cast"><div className="party-heading"><h2><Users size={18}/>{t('The cast')}</h2></div><ul>{room.players.map(player => <li key={player.id}><div><strong>{player.name}</strong>{player.roleName && <span>{player.roleName}</span>}</div><small className={player.connected ? 'is-connected' : ''}>{t(player.connected ? 'Connected' : 'Away')}</small></li>)}</ul></section>
        {canJoin ? <button type="button" className="phone-button" disabled={!connected} onClick={onJoin}>{t('Join as a player')}<ArrowRight size={19}/></button> : <section className="party-next-case"><h2>{t('Join the next mystery')}</h2><p>{t('You can join when the next lobby opens with a free seat.')}</p></section>}
      </main>
    </div>
  </div>;
}
