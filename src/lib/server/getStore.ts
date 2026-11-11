import { MemoryStore } from './memoryStore';
import { PgStore } from './pgStore';
import type { Store } from './store';

const g = globalThis as unknown as { __manhuntStore?: Store };

/** DATABASE_URL → Postgres (Supabase). Otherwise an in-memory store for local dev and the simulator. */
export function getStore(): Store {
  if (g.__manhuntStore) return g.__manhuntStore;
  const url = process.env.DATABASE_URL;
  if (url) g.__manhuntStore = new PgStore(url);
  else {
    if (process.env.VERCEL && process.env.ALLOW_MEMORY_STORE !== '1')
      throw new Error('DATABASE_URL is not set. Serverless deployments need Postgres (see README → Configure Supabase).');
    g.__manhuntStore = new MemoryStore();
  }
  return g.__manhuntStore;
}
