import { useEffect, useRef } from 'react';
import type { RoomView } from '../../shared/types';
import { createProceduralScore, stageMusicGain, type MusicGate, type ProceduralScore } from './procedural-score';

/** No context is created or resumed here: the TV's explicit Sound button owns that gesture. */
export function useStageMusic(context: AudioContext | null, room: RoomView, gate: MusicGate): number {
  const score = useRef<{ context: AudioContext; phase: RoomView['phase']; player: ProceduralScore } | null>(null);
  const level = context?.state === 'running' ? stageMusicGain(room, gate) : 0;
  useEffect(() => {
    if (!context || level <= 0) { score.current?.player.stop(); score.current = null; return; }
    if (!score.current || score.current.context !== context || score.current.phase !== room.phase) {
      score.current?.player.stop(); score.current = { context, phase: room.phase, player: createProceduralScore(context, room.phase) };
    }
    score.current.player.setLevel(level);
  }, [context, room.phase, level]);
  useEffect(() => () => { score.current?.player.stop(); score.current = null; }, []);
  return level;
}
