import { useId } from 'react';
import { Focus, Monitor, Music2, X } from 'lucide-react';
import { publicEvidence } from '../../shared/evidence-browser';
import { screenPlayback } from '../../shared/screen-playback';
import { useAttentionCountdown } from '../useAttentionCountdown';
import { usePartyLanguage } from '../party-translations';
import { usePartyAction, type PartyActionProps } from './party-ui';

export function StageControls(props: PartyActionProps) {
  if (!props.room.isMaster) return null;
  return <Settings {...props}/>;
}
function Settings({ room, connected, disabled = false, onAction }: PartyActionProps) {
  const { t, language } = usePartyLanguage();
  const { run, busy, error } = usePartyAction(onAction);
  const id = useId();
  const countdown = useAttentionCountdown(room);
  const settings = room.stageSettings ?? { distanceMode: false, musicEnabled: true, musicVolume: 25 };
  const unavailable = !connected || disabled || busy;
  const playing = screenPlayback(room, connected, room.serverNow ?? NaN).status === 'playing';
  const spotlightBusy = unavailable || countdown > 0 || playing;
  const evidence = publicEvidence(room);
  const volumes = [10,25,50,75,100];
  if (!volumes.includes(settings.musicVolume)) volumes.push(settings.musicVolume);
  return <section className="gm-card party-card party-stage-settings" lang={language} aria-label={t('Stage and sound')}>
    <div className="party-heading"><h2><Monitor size={19}/>{t('Stage and sound')}</h2></div>
    <label className="party-check"><input type="checkbox" checked={settings.distanceMode} disabled={unavailable} onChange={event => void run({ type: 'stage-settings', settings: { distanceMode: event.target.checked } })}/><span>{t('Across-the-room mode')}</span></label>
    <p className="party-secondary">{t('Larger text and fewer evidence cards at once.')}</p>
    <label className="party-check"><input type="checkbox" checked={settings.musicEnabled} disabled={unavailable} onChange={event => void run({ type: 'stage-settings', settings: { musicEnabled: event.target.checked } })}/><span><Music2 size={16}/>{t('Background music')}</span></label>
    <p className="party-secondary">{t('Enable Sound on the TV once. Music pauses for shared moments and stays quiet under speech.')}</p>
    <label className="party-field" htmlFor={`${id}-volume`}>{t('Music volume')}<select id={`${id}-volume`} disabled={unavailable} value={settings.musicVolume} onChange={event => void run({ type: 'stage-settings', settings: { musicVolume: Number(event.target.value) } })}>{volumes.sort((a,b) => a-b).map(volume => <option value={volume} key={volume}>{volume}%</option>)}</select></label>
    <div className="party-divider"/>
    <label className="party-field" htmlFor={`${id}-spotlight`}><span><Focus size={16}/>{t('Spotlight public evidence')}</span><select id={`${id}-spotlight`} data-spotlight disabled={spotlightBusy || !evidence.length} value={room.spotlight?.evidenceId ?? ''} onChange={event => { if (event.target.value) void run({ type: 'spotlight', evidenceId: event.target.value }); }}><option value="">{t('Choose public evidence')}</option>{evidence.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label>
    <p className="party-secondary">{t(!evidence.length ? 'No public evidence to spotlight yet.' : countdown > 0 || playing ? 'Let the current shared moment finish first.' : 'A spotlight gathers everyone for ten seconds, then holds this public card on the TV.')}</p>
    {room.spotlight && <button className="party-button secondary" type="button" disabled={unavailable} onClick={() => void run({ type: 'spotlight', evidenceId: null })}><X size={15}/>{t('Clear spotlight')}</button>}
    {error && <p className="party-error" role="alert">{t(error)}</p>}
  </section>;
}
