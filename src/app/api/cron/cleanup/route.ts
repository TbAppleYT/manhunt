import type { NextRequest } from 'next/server';
import { cleanup } from '@/lib/server/service';
import { getStore } from '@/lib/server/getStore';
import { handle, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
/** Vercel Cron calls this daily (vercel.json). Deletes expired games, their photos and replay data. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401);
    return json({ deleted: await cleanup(getStore()) });
  });
}
