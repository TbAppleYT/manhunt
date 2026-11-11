import type { NextRequest } from 'next/server';
import { getView } from '@/lib/server/service';
import { getStore } from '@/lib/server/getStore';
import { bearer, handle, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { playerId, token } = bearer(req);
    const since = Math.max(0, Number(req.nextUrl.searchParams.get('since')) || 0);
    return json(await getView(getStore(), id, playerId, token, since));
  });
}
