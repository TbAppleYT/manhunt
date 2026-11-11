import type { NextRequest } from 'next/server';
import { MAX_PHOTO_BYTES, uploadPhoto } from '@/lib/server/service';
import { getStore } from '@/lib/server/getStore';
import { bearer, handle, json } from '@/lib/server/http';
import { GameError } from '@/lib/engine/engine';

export const dynamic = 'force-dynamic';
/** Body: the raw image bytes (the client downsizes to ~1600 px JPEG before sending). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { playerId, token } = bearer(req);
    if (Number(req.headers.get('content-length') || 0) > MAX_PHOTO_BYTES) throw new GameError('too_big', 'That photo is too large.', 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    return json(await uploadPhoto(getStore(), id, playerId, token, bytes));
  });
}
