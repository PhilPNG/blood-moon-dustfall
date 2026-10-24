import { Check, CheckCircle2, Monitor, Play, Smartphone, WifiOff } from 'lucide-react';
import { screenPlayback } from '../../shared/screen-playback';
import { useAttentionCountdown } from '../useAttentionCountdown';
import { usePartyLanguage } from '../party-translations';
import { useLocalPartyFlags, usePartyAction, type PartyActionProps } from './party-ui';

export function HostPreflight(props: PartyActionProps) {
  const { room } = props;
  if (!room.isMaster || room.phase !== 'lobby') return null;
  const storageKey = `dustfall:preflight:v1:${JSON.stringify([room.code, room.gameMaster?.id ?? 'legacy', room.gameMaster?.epoch ?? 0, room.expiresAt ?? null, room.actionEpoch ?? 0])}`;
  return <Preflight key={storageKey} {...props} storageKey={storageKey}/>;
}
function Preflight({ room, connected, disabled = false, onAction, storageKey }: PartyActionProps & { storageKey: string }) {
  const { t, language } = usePartyLanguage();
  const { run, busy, error } = usePartyAction(onAction);
  const [flags, update] = useLocalPartyFlags(storageKey, ['sound','captions','distance','recovery'] as const);
  const countdown = useAttentionCountdown(room);
  const playing = screenPlayback(room, connected, room.serverNow ?? NaN).status === 'playing';
  const checks = [
    ['sound', 'I heard sound on the TV'], ['captions', 'I could read the captions'],
    ['distance', 'The screen is readable across the room'], ['recovery', 'I saved my private GM recovery code'],
  ] as const;
  const connectedGuests = room.players.filter(player => player.connected && !player.isDemo).length;
  return <section className="gm-card party-card party-preflight" lang={language} aria-label={t('Party check')}>
    <div className="party-heading"><h2><CheckCircle2 size={19}/>{t('Party check')}</h2></div>
    <p>{t('A quick check before the mystery. This never blocks Start.')}</p>
    <ul className="party-status-list">
      <li data-ready={room.displayConnected === true}><Monitor size={17}/>{t(room.displayConnected ? 'TV connected' : 'Waiting for the TV')}</li>
      <li data-ready={connected}>{connected ? <Check size={17}/> : <WifiOff size={17}/>} {connected ? t('Your GM phone is connected') : t('Reconnecting')}</li>
      <li><Smartphone size={17}/>{t('{count} guest phones connected', { count: connectedGuests })}</li>
    </ul>
    <button className="party-button" type="button" disabled={disabled || !connected || busy || countdown > 0 || playing} onClick={() => void run({ type: 'preflight-test' })}><Play size={17}/>{t(busy ? 'Saving…' : room.preflight ? 'Run screen test again' : 'Run screen test')}</button>
    <p className="party-secondary">{t(room.preflight?.completed ? 'The TV reported the test playback. Confirm these checks yourself.' : 'A ten-second countdown, then a short existing film. Confirm sound and captions yourself.')}</p>
    <div className="party-checks">{checks.map(([id, label]) => <label className="party-check" key={id}><input type="checkbox" checked={flags[id]} onChange={event => update(id, event.target.checked)}/><span>{t(label)}</span></label>)}</div>
    <small>{t('Saved only on this browser.')}</small>
    {error && <p className="party-error" role="alert">{t(error)}</p>}
  </section>;
}
