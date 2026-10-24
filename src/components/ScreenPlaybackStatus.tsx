import { useEffect, useRef, useState } from 'react';
import { Film, Mic2, Monitor } from 'lucide-react';
import { formatTime } from '../../shared/format';
import { screenPlayback } from '../../shared/screen-playback';
import type { RoomView } from '../../shared/types';
import { useLanguage } from '../i18n';

const monotonicNow = () => typeof performance === 'undefined' ? 0 : performance.now();

/** Silent awareness of actual TV playback. The GM phone never opens a media player. */
export function ScreenPlaybackStatus({ room, connected }: { room: RoomView; connected: boolean }) {
  const { t } = useLanguage();
  const [, refresh] = useState(0);
  const sample = useRef({ server: room.serverNow, received: monotonicNow() });
  if (!Object.is(sample.current.server, room.serverNow)) sample.current = { server: room.serverNow, received: monotonicNow() };
  const now = typeof sample.current.server === 'number' ? sample.current.server + Math.max(0, monotonicNow() - sample.current.received) : NaN;
  const playback = screenPlayback(room, connected, now);
  const active = 'position' in playback;

  useEffect(() => {
    if (!active) return;
    const update = () => refresh(value => value + 1);
    const interval = window.setInterval(update, 250);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', update); };
  }, [active]);

  const label = playback.status === 'playing' ? 'Playing' : playback.status === 'holding' ? 'On hold'
    : playback.status === 'complete' ? 'Finished' : playback.status === 'paused' ? 'Game paused'
      : playback.status === 'offline' ? 'Reconnecting' : 'Standby';
  const hint = playback.status === 'holding' ? 'The public screen is paused or loading.'
    : playback.status === 'complete' ? playback.kind === 'film' ? 'The film has finished. The narrator may speak next.' : 'The announcement has finished. You decide the next move.'
      : playback.status === 'paused' ? 'Resume the game to continue the public presentation.'
        : playback.status === 'offline' ? 'Waiting to reconnect before showing live playback.'
          : playback.status === 'standby' ? 'Progress appears here when the public screen plays a film or narration.'
            : 'Let films and narration finish before advancing.';
  const elapsed = active ? formatTime(playback.position) : '';
  const duration = active ? formatTime(playback.duration) : '';

  return <section className="gm-card gm-media-status" data-status={playback.status} aria-label={t('Public screen playback')}>
    <div className="gm-card-heading"><h2><Monitor size={18} />{t('On the big screen')}</h2></div>
    <div className="gm-media-announcement" role="status">
      <div className="gm-media-labels"><span className="gm-media-kind">{active && <>{playback.kind === 'film' ? <Film size={14} /> : <Mic2 size={14} />}{t(playback.kind === 'film' ? 'Story film' : 'Narrator')}</>}</span><span className="gm-media-state"><i aria-hidden="true" />{t(label)}</span></div>
      <h3>{active ? t(playback.title) : t(playback.status === 'standby' ? 'No recent playback' : label)}</h3>
    </div>
    {active && <div className="gm-media-progress">
      <div className="gm-media-track" role="progressbar" aria-label={t('Public presentation progress')} aria-valuemin={0} aria-valuemax={playback.duration} aria-valuenow={playback.position} aria-valuetext={t('{elapsed} of {duration}', { elapsed, duration })}><span style={{ width: `${playback.progress}%` }} /></div>
      <div className="gm-media-times" aria-hidden="true"><span>{elapsed}</span><span>{duration}</span></div>
    </div>}
    <p className="gm-media-hint">{t(hint)}</p>
  </section>;
}
