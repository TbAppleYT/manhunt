import { expect, test } from '@playwright/test';
import { acceptRules, phone } from './helpers';

test('five phones play a full real game: lobby → groups → head start → catches → dispute → pause → winner → replay', async ({ browser }) => {
  const host = await phone(browser, 3);
  await host.page.goto('/create');
  await host.page.fill('[data-testid=nick-input]', 'Host');
  await host.page.click('[data-testid=submit-entry]');
  await expect(host.page.getByTestId('lobby')).toBeVisible();
  const code = (await host.page.getByTestId('game-code').textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);

  const names: [string, number][] = [['Ava', 7], ['Ben', 7], ['Cleo', 5], ['Dev', 5]];
  const ps: Record<string, Awaited<ReturnType<typeof phone>>> = {};
  for (const [n, sec] of names) {
    const c = await phone(browser, sec); ps[n] = c;
    await c.page.goto('/join?code=' + code);
    await c.page.fill('[data-testid=nick-input]', n);
    await c.page.click('[data-testid=submit-entry]');
    await expect(c.page.getByTestId('lobby')).toBeVisible();
  }
  // Duplicate nickname is refused.
  const dup = await phone(browser, 7);
  await dup.page.goto('/join?code=' + code);
  await dup.page.fill('[data-testid=nick-input]', 'ava');
  await dup.page.click('[data-testid=submit-entry]');
  await expect(dup.page.locator('p.err')).toContainText('already has that nickname');
  await dup.ctx.close();

  // Host: 30-second head start, roles.
  await host.page.click('[data-testid=tab-settings]');
  const hs = host.page.getByLabel('Head start', { exact: true });
  await hs.fill('0.5'); await hs.blur();
  await host.page.click('[data-testid=tab-players]');
  const role = async (n: string, r: string) => {
    await host.page.click(`[data-testid="player-${n}"]`);
    await host.page.getByRole('group', { name: 'Role' }).getByRole('button', { name: r }).click();
    await host.page.keyboard.press('Escape');
  };
  await role('Host', 'Seeker');
  for (const [n] of names) await role(n, 'Hider');

  // Hiders form two confirmed groups.
  for (const [n] of names) await ps[n].page.click('[data-testid=tab-teams]');
  await ps.Ava.page.fill('#gname', 'Group A'); await ps.Ava.page.click('[data-testid=create-group]');
  await ps.Cleo.page.fill('#gname', 'Group B'); await ps.Cleo.page.click('[data-testid=create-group]');
  await ps.Ben.page.click('[data-testid="join-Group A"]'); await ps.Ben.page.click('[data-testid=confirm-group]');
  await ps.Dev.page.click('[data-testid="join-Group B"]'); await ps.Dev.page.click('[data-testid=confirm-group]');

  await acceptRules(host.page);
  for (const [n] of names) { await acceptRules(ps[n].page); await ps[n].page.click('[data-testid=ready]'); }
  await expect(host.page.getByTestId('start-problems')).toHaveCount(0, { timeout: 10_000 });
  await host.page.click('[data-testid=start]');

  // Head start: synchronized countdown, catches disabled.
  await expect(host.page.getByTestId('play')).toBeVisible();
  await expect(host.page.getByTestId('timer-label')).toHaveText('Seekers released in');
  await expect(ps.Ava.page.getByTestId('timer-label')).toHaveText('Head start');
  await host.page.click('[data-testid=primary]');
  await expect(host.page.getByTestId('sheet-catch')).toContainText('open when the head start ends');
  await host.page.keyboard.press('Escape');
  await expect(host.page.getByTestId('timer-label')).toHaveText('Next sector vote', { timeout: 45_000 });

  // Catch → hider confirms → becomes a seeker.
  const report = async (n: string) => {
    await host.page.click('[data-testid=primary]');
    await host.page.getByRole('radio', { name: new RegExp(n) }).click();
    await host.page.click('[data-testid=send-catch]');
    await expect(ps[n].page.getByTestId('catch-confirm')).toBeVisible({ timeout: 10_000 });
  };
  await report('Ava');
  await ps.Ava.page.getByRole('button', { name: 'Yes, I was caught' }).click();
  await expect(ps.Ava.page.getByTestId('role-pill')).toHaveText('Seeker');
  await expect(ps.Ben.page.getByTestId('role-pill')).toHaveText('Hider'); // only the caught player changes role

  // Dispute → host decides "not caught".
  await report('Cleo');
  await ps.Cleo.page.getByRole('button', { name: 'Dispute' }).click();
  await host.page.click('[data-testid=act-more]'); await host.page.click('[data-testid=open-host]');
  await host.page.click('[data-testid=host-tab-review]');
  await host.page.getByRole('button', { name: 'Not caught' }).click();
  await expect(ps.Cleo.page.getByTestId('role-pill')).toHaveText('Hider');

  // Pause freezes everyone's countdown.
  await host.page.click('[data-testid=host-tab-game]'); await host.page.click('[data-testid=host-pause]');
  await expect(ps.Ben.page.getByTestId('timer-label')).toHaveText('Paused by host', { timeout: 10_000 });
  const frozen = await ps.Ben.page.getByTestId('timer').textContent();
  await ps.Ben.page.waitForTimeout(2500);
  expect(await ps.Ben.page.getByTestId('timer').textContent()).toBe(frozen);
  await host.page.click('[data-testid=host-resume]'); await host.page.keyboard.press('Escape');
  await expect(ps.Ben.page.getByTestId('timer-label')).not.toHaveText('Paused by host', { timeout: 10_000 });

  // Privacy: other players carry no coordinates, and teammates arrive grid-snapped (never the raw fix).
  const priv = await ps.Cleo.page.evaluate(async () => {
    const id = location.pathname.split('/').pop()!;
    const s = JSON.parse(localStorage.getItem('mh.session.' + id)!);
    const r = await fetch(`/api/games/${id}`, { headers: { authorization: `Bearer ${s.playerId}.${s.token}` } }).then((x) => x.json());
    return { players: JSON.stringify(r.view.players), teammates: r.view.teammates as { nickname: string; lat: number; lon: number }[] };
  });
  expect(priv.players).not.toMatch(/"(lat|lon|fix|sector)"/);
  expect(priv.teammates.map((t) => t.nickname)).toEqual(['Dev']);
  const dLat = (25 / 6371008.8) * (180 / Math.PI);
  const q = priv.teammates[0].lat / dLat;
  expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-6);

  // Ben and Dev caught → Cleo is the last hider and wins.
  for (const n of ['Ben', 'Dev']) { await report(n); await ps[n].page.getByRole('button', { name: 'Yes, I was caught' }).click(); }
  await expect(ps.Cleo.page.getByTestId('results')).toBeVisible({ timeout: 15_000 });
  await expect(ps.Cleo.page.getByTestId('winner')).toHaveText('You won');
  await expect(host.page.getByTestId('winner')).toHaveText('Cleo');
  await ps.Cleo.page.click('[data-testid=open-replays]');
  await expect(ps.Cleo.page.getByText('Stylised reconstruction · not real movement')).toBeVisible();

  // Host returns everyone to the lobby.
  await host.page.click('[data-testid=to-lobby]');
  await expect(ps.Dev.page.getByTestId('lobby')).toBeVisible({ timeout: 10_000 });
});
