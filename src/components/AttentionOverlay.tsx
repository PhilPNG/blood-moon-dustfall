import { useId } from 'react';
import { Eye, Monitor, Pause, Radio, WifiOff } from 'lucide-react';
import type { RoomView } from '../../shared/types';
import { useLanguage } from '../i18n';
import { attentionTranslations } from '../attention-translations';
import { useAttentionCountdown } from '../useAttentionCountdown';

export function AttentionOverlay({ room, variant = 'phone', connected = true }: { room: RoomView; variant?: 'host' | 'phone' | 'master'; connected?: boolean }) {
  const { language } = useLanguage();
  const labels = attentionTranslations[language];
  const seconds = useAttentionCountdown(room);
  const titleId = useId();
  if (seconds <= 0 || !room.attention) return null;

  const paused = room.timer.isPaused;
  const status = !connected ? labels.reconnecting : paused ? labels.paused : labels.synced;
  const StatusIcon = !connected ? WifiOff : paused ? Pause : Radio;
  const title = variant === 'host' ? labels.hostTitle : variant === 'master' ? labels.masterTitle : labels.phoneTitle;
  const circumference = 2 * Math.PI * 52;
  const progress = Math.max(0, Math.min(1, seconds / 10));

  return <section className={`attention-overlay attention--${variant}${paused ? ' is-paused' : ''}${!connected ? ' is-reconnecting' : ''}`} lang={language} aria-label={labels.label} aria-labelledby={titleId}>
    <div className="attention-stage">
      <div className="attention-countdown" role="timer" aria-live="off" aria-label={labels.seconds}>
        <svg className="attention-ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <circle className="attention-ring-track" cx="60" cy="60" r="52"/>
          <circle className="attention-ring-progress" cx="60" cy="60" r="52" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)}/>
        </svg>
        <span className="attention-number" key={seconds}>{seconds}</span>
        <span className="attention-seconds">{labels.seconds}</span>
      </div>
      <div className="attention-copy">
        <div className="attention-eyeline"><Eye size={18} aria-hidden="true"/><span>{labels.cues[room.attention.cue] ?? labels.cues.phase}</span></div>
        <h2 id={titleId}>{title}</h2>
        <p>{variant === 'master' ? labels.masterInstruction : labels.instruction}</p>
        <div className="attention-status" role="status" aria-live="polite" aria-atomic="true"><StatusIcon size={14} aria-hidden="true"/><span>{status}</span></div>
      </div>
      {variant !== 'master' && <Monitor className="attention-screen-mark" size={56} aria-hidden="true"/>}
    </div>
  </section>;
}
