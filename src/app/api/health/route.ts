import { getStore } from '@/lib/server/getStore';
import { json } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  let store = 'unconfigured';
  try { store = getStore().kind; } catch { /* reported below */ }
  return json({ ok: store !== 'unconfigured', store, realtime: !!process.env.SUPABASE_URL, push: !!process.env.VAPID_PRIVATE_KEY, map: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ? 'mapbox' : 'static' });
}
