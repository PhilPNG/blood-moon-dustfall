import type { RoomView } from './types.js';
export type MinglePrompt = 'alibi' | 'evidence' | 'theory' | 'contradiction' | 'timeline';
export interface MingleCard { targetId: string; targetName: string; characterName?: string; prompt: MinglePrompt }
export function minglingCard(room: RoomView): MingleCard | null {
  if (room.phase !== 'investigation' || !room.me || !Number.isInteger(room.round) || room.round < 1) return null;
  const present = room.players.filter(player => player.connected && !player.isDemo);
  const index = present.findIndex(player => player.id === room.me!.playerId);
  if (index < 0 || present.length < 2) return null;
  const target = present[(index + 1 + (room.round - 1) % (present.length - 1)) % present.length];
  const prompts: MinglePrompt[] = ['alibi', 'evidence', 'theory', 'contradiction', 'timeline'];
  return { targetId: target.id, targetName: target.name, characterName: target.roleName, prompt: prompts[(room.round - 1) % prompts.length] };
}
export function minglingStorageKey(room: RoomView, targetId: string): string {
  return `dustfall:mingle:v1:${JSON.stringify([room.code, room.gameId ?? 'legacy', room.actionEpoch ?? 0, room.me?.playerId ?? null, room.round, targetId])}`;
}
