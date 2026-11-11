/* Postgres store (Supabase in production). Every mutation runs in one transaction holding a row lock
   (SELECT ... FOR UPDATE), so concurrent commands on the same game are serialised and never lost. */
import postgres from 'postgres';
import type { GameState } from '@/lib/engine/types';
import { StoreError, type Loaded, type Store } from './store';

export class PgStore implements Store {
  readonly kind = 'postgres' as const;
  private sql: postgres.Sql;
  constructor(url: string) {
    // prepare:false keeps us compatible with Supabase's transaction pooler (port 6543) on serverless.
    this.sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  }
  async end() { await this.sql.end({ timeout: 2 }); }

  async insert(state: GameState) {
    try {
      await this.sql.begin(async (tx) => {
        // Free the code if the previous game that used it has expired.
        await tx`delete from games where code = ${state.code} and expires_at <= now()`;
        await tx`insert into games (id, code, simulation, state, version, expires_at)
                 values (${state.id}, ${state.code}, ${state.simulation}, ${tx.json(state as never)}, 1, to_timestamp(${state.expiresAt / 1000}))`;
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new StoreError('code_taken');
      throw e;
    }
  }
  async findByCode(code: string) {
    const r = await this.sql`select id, simulation from games where code = ${code} and expires_at > now()`;
    return r[0] ? { id: r[0].id as string, simulation: r[0].simulation as boolean } : null;
  }
  async load(id: string): Promise<Loaded | null> {
    const r = await this.sql`select state, version from games where id = ${id}`;
    return r[0] ? { state: r[0].state as GameState, version: r[0].version as number } : null;
  }
  async mutate<T>(id: string, fn: (s: GameState) => T) {
    return this.sql.begin(async (tx) => {
      const r = await tx`select state, version from games where id = ${id} for update`;
      if (!r[0]) throw new StoreError('not_found');
      const state = r[0].state as GameState;
      const result = fn(state); // throwing rolls the transaction back
      const version = (r[0].version as number) + 1;
      await tx`update games set state = ${tx.json(state as never)}, version = ${version}, updated_at = now(),
               expires_at = to_timestamp(${state.expiresAt / 1000}) where id = ${id}`;
      return { state, version, result };
    }) as Promise<Loaded & { result: T }>;
  }
  async putPhoto(gameId: string, photoId: string, mime: string, bytes: Uint8Array) {
    await this.sql`insert into photos (game_id, id, mime, bytes) values (${gameId}, ${photoId}, ${mime}, ${Buffer.from(bytes)})`;
  }
  async getPhoto(gameId: string, photoId: string) {
    const r = await this.sql`select mime, bytes from photos where game_id = ${gameId} and id = ${photoId}`;
    return r[0] ? { mime: r[0].mime as string, bytes: new Uint8Array(r[0].bytes as Buffer) } : null;
  }
  async deletePhoto(gameId: string, photoId: string) { await this.sql`delete from photos where game_id = ${gameId} and id = ${photoId}`; }
  async hit(key: string, limit: number, windowSec: number) {
    const r = await this.sql`
      insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limits.count + 1 end,
        window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limits.window_start end
      returning count`;
    return (r[0].count as number) <= limit;
  }
  async cleanup(now: number) {
    const r = await this.sql`delete from games where expires_at <= to_timestamp(${now / 1000}) returning id`; // photos cascade
    await this.sql`delete from rate_limits where window_start < now() - interval '1 day'`;
    return r.length;
  }
}
