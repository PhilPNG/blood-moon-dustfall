export interface StoredRoom { code: string; state: string; revision: number; expiresAt: number }
export interface RoomRepository {
  get(code: string): Promise<StoredRoom | undefined>;
  insert(room: StoredRoom, now: number, capacity: number): Promise<boolean>;
  compareAndSwap(room: StoredRoom, expectedRevision: number): Promise<boolean>;
  purgeExpired(now: number): Promise<void>;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes?: number } }>;
}
/** The subset of Cloudflare's D1 binding used by the room store. */
export interface D1DatabaseBinding { prepare(sql: string): D1Statement }
export type D1Database = D1DatabaseBinding;

export class MemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, StoredRoom>();
  async get(code: string): Promise<StoredRoom | undefined> {
    const room = this.rooms.get(code);
    return room ? { ...room } : undefined;
  }
  async insert(room: StoredRoom, now: number, capacity: number): Promise<boolean> {
    if (this.rooms.has(room.code) || [...this.rooms.values()].filter(value => value.expiresAt > now).length >= capacity) return false;
    this.rooms.set(room.code, { ...room });
    return true;
  }
  async compareAndSwap(room: StoredRoom, expectedRevision: number): Promise<boolean> {
    if (this.rooms.get(room.code)?.revision !== expectedRevision) return false;
    this.rooms.set(room.code, { ...room, revision: expectedRevision + 1 });
    return true;
  }
  async purgeExpired(now: number): Promise<void> {
    let deleted = 0;
    for (const [code, room] of this.rooms) if (room.expiresAt <= now && deleted++ < 500) this.rooms.delete(code);
  }
}

export class D1RoomRepository implements RoomRepository {
  constructor(private readonly db: D1DatabaseBinding) {}
  async get(code: string): Promise<StoredRoom | undefined> {
    const row = await this.db.prepare('SELECT code, state, revision, expires_at AS expiresAt FROM rooms WHERE code = ?').bind(code).first<StoredRoom>();
    return row ?? undefined;
  }
  async insert(room: StoredRoom, now: number, capacity: number): Promise<boolean> {
    const result = await this.db.prepare('INSERT INTO rooms (code, state, revision, expires_at) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM rooms WHERE expires_at > ?) < ? ON CONFLICT(code) DO NOTHING')
      .bind(room.code, room.state, room.revision, room.expiresAt, now, capacity).run();
    return result.meta.changes === 1;
  }
  async compareAndSwap(room: StoredRoom, expectedRevision: number): Promise<boolean> {
    const result = await this.db.prepare('UPDATE rooms SET state = ?, revision = revision + 1, expires_at = ? WHERE code = ? AND revision = ?')
      .bind(room.state, room.expiresAt, room.code, expectedRevision).run();
    return result.meta.changes === 1;
  }
  async purgeExpired(now: number): Promise<void> {
    await this.db.prepare('DELETE FROM rooms WHERE code IN (SELECT code FROM rooms WHERE expires_at <= ? LIMIT 500)').bind(now).run();
  }
}
