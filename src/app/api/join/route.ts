import type { NextRequest } from 'next/server';
import { joinGame } from '@/lib/server/service';
import { getStore } from '@/lib/server/getStore';
import { JoinBody } from '@/lib/server/schemas';
import { clientIp, handle, json, readJson } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  return handle(async () => json(await joinGame(getStore(), await readJson(req, JoinBody), clientIp(req))));
}
