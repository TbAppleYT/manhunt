/* Web Push (optional). Needs VAPID keys in env. Only sent to players who look backgrounded
   (no poll for 20 s), and only for events that carry an announcement — the important ones. */
import type { GameEvent } from '@/lib/engine/types';

let configured: boolean | null = null;
async function wp() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  const mod = (await import('web-push')).default;
  if (!configured) { mod.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:host@example.com', pub, priv); configured = true; }
  return mod;
}

export async function pushEvents(players: { id: string; push: unknown; lastSeen: number }[], events: GameEvent[], canSee: (pid: string, e: GameEvent) => boolean) {
  const lib = await wp();
  if (!lib) return;
  const now = Date.now();
  const important = events.filter((e) => e.sound?.length);
  if (!important.length) return;
  await Promise.all(players.filter((p) => now - p.lastSeen > 20_000).map(async (p) => {
    const mine = important.filter((e) => canSee(p.id, e));
    if (!mine.length) return;
    const last = mine[mine.length - 1];
    try {
      await lib.sendNotification(p.push as never, JSON.stringify({ title: 'manhunt.', body: last.text, tag: 'manhunt-game' }), { TTL: 120 });
    } catch { /* expired subscriptions are ignored */ }
  }));
}
