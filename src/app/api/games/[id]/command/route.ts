import type { NextRequest } from 'next/server';
import { runCommand } from '@/lib/server/service';
import { getStore } from '@/lib/server/getStore';
import { CommandBody } from '@/lib/server/schemas';
import { bearer, handle, json, readJson } from '@/lib/server/http';
import type { Command } from '@/lib/engine/engine';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { playerId, token } = bearer(req);
    const body = await readJson(req, CommandBody, 256 * 1024);
    return json(await runCommand(getStore(), id, playerId, token, body.cmd as Command, body.cmdId, body.since ?? 0));
  });
}
