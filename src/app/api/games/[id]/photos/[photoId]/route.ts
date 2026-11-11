import type { NextRequest } from 'next/server';
import { readPhoto } from '@/lib/server/service';
import { getStore } from '@/lib/server/getStore';
import { bearer, handle } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
/** The client fetches with its Authorization header and displays the result as a blob URL,
    so session tokens never appear in image URLs, logs or history. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  return handle(async () => {
    const { id, photoId } = await ctx.params;
    const { playerId, token } = bearer(req);
    const img = await readPhoto(getStore(), id, playerId, token, photoId);
    return new Response(Buffer.from(img.bytes), { headers: { 'content-type': img.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } });
  });
}
