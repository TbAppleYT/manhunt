import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => { await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); });

test('theme follows the system and can be pinned; Inter is the font', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/settings');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await bg();
  await page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: 'Light' }).click();
  expect(await bg()).not.toBe(dark);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light'); // remembered
  await page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: 'System' }).click();
  expect(await bg()).toBe(dark);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Inter/);
});

test('sector editor flags overlapping sectors', async ({ page }) => {
  await page.goto('/editor');
  await expect(page.getByText('No overlaps or invalid shapes.')).toBeVisible();
  const h = page.getByRole('button', { name: 'Drag sector 7 corner 1' });
  const box = (await h.boundingBox())!;
  await page.mouse.move(box.x + 7, box.y + 7); await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 60, { steps: 5 }); await page.mouse.up();
  await page.getByLabel('Move shared corners together').uncheck();
  const h2 = page.getByRole('button', { name: 'Drag sector 7 corner 2' });
  const b2 = (await h2.boundingBox())!;
  await page.mouse.move(b2.x + 7, b2.y + 7); await page.mouse.down();
  await page.mouse.move(b2.x + 80, b2.y + 40, { steps: 5 }); await page.mouse.up();
  await expect(page.getByText(/overlap/).first()).toBeVisible();
});

test('closed sheets are removed from keyboard and accessibility navigation', async ({ page }) => {
  await page.goto('/sim');
  await page.click('[data-testid=sim-start]');
  await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
  await page.click('[data-testid=open-permissions]');
  await page.click('[data-testid=accept-rules]');
  const snap = await page.locator('body').ariaSnapshot();
  expect(snap).not.toContain('Before you play');
});
