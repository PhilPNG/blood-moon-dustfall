import type { RoomView } from '../../shared/types';
import { formatTime } from '../../shared/format';
import { useCountdown } from '../useCountdown';
export function Clock({timer, serverNow}:{timer:RoomView['timer']; serverNow?:number}) {
  const seconds = useCountdown(timer, serverNow);
  return <span className={`clock ${seconds <= 30 ? 'clock-low' : ''}`}>{formatTime(seconds)}</span>;
}
