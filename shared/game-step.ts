import type { RoomView } from './types';

/** Stable UI scope: polls keep a choice open; another deal, act or reset retires it. */
export function gameStepIdentity(room: Pick<RoomView, 'gameId' | 'phase' | 'round' | 'actionEpoch'>): string {
  return JSON.stringify([room.gameId ?? null, room.phase, room.round, room.actionEpoch ?? 0]);
}
