import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { GameError } from '@/lib/engine/engine';
import { StoreError } from './store';

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'cache-control': 'no-store' } });

export function clientIp(req: NextRequest) {
  return (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'local').trim().slice(0, 64);
}

/** "Bearer <playerId>.<token>" */
export function bearer(req: NextRequest) {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer ([\w-]+)\.([\w-]+)$/.exec(h);
  if (!m) throw new GameError('unauthorized', 'Missing session.', 401);
  return { playerId: m[1], token: m[2] };
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>, maxBytes = 64 * 1024): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new GameError('too_big', 'Request too large.', 413);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new GameError('bad_json', 'Invalid request.'); }
  return schema.parse(raw);
}

export function handle(fn: () => Promise<Response>) {
  return fn().catch((e: unknown) => {
    if (e instanceof GameError) return json({ error: e.code, message: e.message }, e.status);
    if (e instanceof ZodError) return json({ error: 'invalid', message: 'Invalid request.', issues: e.issues.slice(0, 5).map((i) => i.path.join('.') + ': ' + i.message) }, 400);
    if (e instanceof StoreError && e.code === 'not_found') return json({ error: 'not_found', message: 'This game has ended or expired.' }, 404);
    console.error(e);
    return json({ error: 'server', message: 'Something went wrong on the server. Try again.' }, 500);
  });
}
