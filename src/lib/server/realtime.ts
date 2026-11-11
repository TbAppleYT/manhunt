/* Optional Supabase Realtime nudge. The message carries only a version number — never game data —
   so the channel can be public. Clients then fetch their own filtered view over HTTPS.
   Without Supabase configured, clients fall back to polling (always on as a safety net). */
export async function notifyGame(gameId: string, version: number) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic: `game-${gameId}`, event: 'v', payload: { v: version } }] }),
      signal: AbortSignal.timeout(1500),
    });
  } catch { /* polling covers missed nudges */ }
}
