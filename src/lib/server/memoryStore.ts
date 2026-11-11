/* In-process store for local development, tests and the simulator. Not for production on Vercel:
   serverless instances do not share memory. getStore() refuses it in production unless explicitly allowed. */
import type { GameState } from '@/lib/engine/types';
import { StoreError, type Loaded, type Store } from './store';

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private games = new Map<string, { json: string; version: number }>();
  private codes = new Map<string, string>();
  private photos = new Map<string, { mime: string; bytes: Uint8Array }>();
  private locks = new Map<string, Promise<unknown>>();
  private limits = new Map<string, { start: number; count: number }>();

  async insert(state: GameState) {
    const existing = this.codes.get(state.code);
    if (existing && this.games.has(existing)) throw new StoreError('code_taken');
    this.games.set(state.id, { json: JSON.stringify(state), version: 1 });
    this.codes.set(state.code, state.id);
  }
  async findByCode(code: string) {
    const id = this.codes.get(code);
    const g = id ? this.games.get(id) : null;
    if (!id || !g) return null;
    const s = JSON.parse(g.json) as GameState;
    return { id, simulation: s.simulation };
  }
  async load(id: string): Promise<Loaded | null> {
    const g = this.games.get(id);
    return g ? { state: JSON.parse(g.json), version: g.version } : null;
  }
  async mutate<T>(id: string, fn: (s: GameState) => T) {
    const prev = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.locks.set(id, prev.then(() => mine));
    await prev;
    try {
      const g = this.games.get(id);
      if (!g) throw new StoreError('not_found');
      const state = JSON.parse(g.json) as GameState;
      const result = fn(state); // throws => nothing saved
      const version = g.version + 1;
      this.games.set(id, { json: JSON.stringify(state), version });
      return { state, version, result };
    } finally {
      release();
    }
  }
  async putPhoto(gameId: string, photoId: string, mime: string, bytes: Uint8Array) { this.photos.set(`${gameId}/${photoId}`, { mime, bytes }); }
  async getPhoto(gameId: string, photoId: string) { return this.photos.get(`${gameId}/${photoId}`) ?? null; }
  async deletePhoto(gameId: string, photoId: string) { this.photos.delete(`${gameId}/${photoId}`); }
  async hit(key: string, limit: number, windowSec: number) {
    const now = Date.now(), w = this.limits.get(key);
    if (!w || now - w.start >= windowSec * 1000) { this.limits.set(key, { start: now, count: 1 }); return true; }
    w.count++;
    return w.count <= limit;
  }
  async cleanup(now: number) {
    let n = 0;
    for (const [id, g] of this.games) {
      const s = JSON.parse(g.json) as GameState;
      if (s.expiresAt <= now) {
        this.games.delete(id); this.codes.delete(s.code); n++;
        for (const k of this.photos.keys()) if (k.startsWith(id + '/')) this.photos.delete(k);
      }
    }
    for (const [k, w] of this.limits) if (now - w.start > 3600_000) this.limits.delete(k);
    return n;
  }
}
