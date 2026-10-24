import type { RoomView } from './types.js';

export type PhoneMoveId = 'search' | 'share' | 'answer';
export interface PhoneMove { id: PhoneMoveId; status: 'todo' | 'done' | 'waiting'; completed: number; total: number }
export interface PhoneMoves { done: number; total: 3; items: PhoneMove[] }

export function phoneMoves(room: RoomView): PhoneMoves | null {
  if (room.phase !== 'investigation' || !room.act || !room.me) return null;
  const me = room.me;
  const seen = new Set<string>();
  let shared = 0;
  for (const clue of me.clues) {
    if (clue.playerId !== me.playerId || clue.round !== room.round || seen.has(clue.id)) continue;
    seen.add(clue.id);
    if (clue.published === true) shared += 1;
  }
  const searchDone = me.search !== undefined;
  const answerDone = me.answeredOptionId !== undefined;
  const items: PhoneMove[] = [
    { id: 'search', status: searchDone ? 'done' : 'todo', completed: Number(searchDone), total: 1 },
    { id: 'share', status: seen.size === 0 ? 'waiting' : shared === seen.size ? 'done' : 'todo', completed: shared, total: seen.size },
    { id: 'answer', status: answerDone ? 'done' : 'todo', completed: Number(answerDone), total: 1 },
  ];
  return { done: items.filter(item => item.status === 'done').length, total: 3, items };
}
