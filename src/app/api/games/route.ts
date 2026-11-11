import type { NextRequest } from 'next/server';
import { createNewGame } from '@/lib/server/service';
import { getStore } from '@/lib/server/getStore';
import { CreateBody } from '@/lib/server/schemas';
import { clientIp, handle, json, readJson } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  return handle(async () => json(await createNewGame(getStore(), await readJson(req, CreateBody), clientIp(req))));
}
