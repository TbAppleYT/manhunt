import type { NextRequest } from 'next/server';
import { postLocation } from '@/lib/server/service';
import { getStore } from '@/lib/server/getStore';
import { LocationBody } from '@/lib/server/schemas';
import { bearer, handle, json, readJson } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { playerId, token } = bearer(req);
    return json(await postLocation(getStore(), id, playerId, token, await readJson(req, LocationBody, 1024)));
  });
}
