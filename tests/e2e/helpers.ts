import type { Browser, BrowserContext, Page } from '@playwright/test';
import fc from '../../src/data/sectors.provisional.geojson.json';

export function ctr(n: number) {
  const r = (fc as { features: { properties: { sector: number }; geometry: { coordinates: number[][][] } }[] }).features.find((f) => f.properties.sector === n)!.geometry.coordinates[0].slice(0, -1);
  return { latitude: r.reduce((a, p) => a + p[1], 0) / r.length, longitude: r.reduce((a, p) => a + p[0], 0) / r.length, accuracy: 6 };
}

/** A phone at Town Center. Emits a reading every 4 s like a real device (headless Chromium otherwise reports once). */
export async function phone(browser: Browser, sector: number, scheme: 'light' | 'dark' = 'light'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ colorScheme: scheme, geolocation: ctr(sector), permissions: ['geolocation'], isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const base = ctr(sector); let k = 0;
  const iv = setInterval(() => { k++; ctx.setGeolocation({ ...base, latitude: base.latitude + ((k % 3) - 1) * 4e-6 }).catch(() => {}); }, 4000);
  ctx.on('close', () => clearInterval(iv));
  return { ctx, page: await ctx.newPage() };
}

export async function acceptRules(page: Page) {
  await page.click('[data-testid=open-permissions]');
  await page.click('[data-testid=accept-rules]');
}
