import { expect, test } from '@playwright/test';
import { acceptRules } from './helpers';

test('simulator: bots, accelerated timers, voting, closure, search zone, photo review', async ({ page, context }) => {
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('/sim');
  await page.click('[data-testid=sim-start]');
  await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
  await acceptRules(page);
  await expect(page.getByTestId('start-problems')).toHaveCount(0, { timeout: 10_000 });
  await page.click('[data-testid=start]');
  await page.click('[data-testid=sim-open]');
  await page.click('[data-testid=skip-headstart]');
  await expect(page.getByTestId('timer-label')).toHaveText('Next sector vote', { timeout: 10_000 });
  await expect(page.getByTestId('gps-paused')).toHaveCount(0);

  await page.click('[data-testid=skip-zone]');
  await expect(page.locator('.zlabel').first()).toContainText('Search zone', { timeout: 10_000 });

  await page.click('[data-testid=skip-vote]');
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByTestId('timer-label')).toHaveText('Voting closes', { timeout: 10_000 });
  await page.click('[data-testid=act-vote]');
  await page.click('[data-testid=vote-4]');
  await page.click('[data-testid=cast-vote]');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-sector="4"]')).toContainText('·', { timeout: 10_000 }); // closing countdown
  await page.click('[data-testid=sim-open]');
  await page.click('[data-testid=skip-closing]');
  await expect(page.locator('[data-sector="4"]')).toContainText('Closed', { timeout: 10_000 });

  await page.click('[data-testid=skip-photo]');
  await page.getByRole('button', { name: 'Hide' }).click();
  await page.waitForTimeout(4000); // bots submit ~10 game-seconds in
  await page.click('[data-testid=act-more]');
  await page.click('[data-testid=open-host]');
  await page.click('[data-testid=host-tab-review]');
  await expect(page.getByTestId('photo-review').first()).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('approve-photo').first().click();
});

test('simulation games cannot be joined from the normal join screen', async ({ page, context, browser }) => {
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('/sim');
  await page.click('[data-testid=sim-start]');
  await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
  const code = (await page.getByTestId('game-code').textContent())!.trim();
  const other = await browser.newContext(); const p2 = await other.newPage();
  await p2.goto('/join?code=' + code);
  await p2.fill('[data-testid=nick-input]', 'Stranger');
  await p2.click('[data-testid=submit-entry]');
  await expect(p2.locator('p.err')).toContainText('No game with that code');
  await other.close();
});
