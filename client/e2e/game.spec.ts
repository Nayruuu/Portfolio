import { test, expect, type Page } from '@playwright/test';

/** Read a live numeric field off the game state. The HUD is now a single canvas (no DOM text), so we
 *  reach the component instance through Angular's dev-mode `ng` global instead of scraping the bar. */
function gameField(page: Page, field: string): Promise<number | null> {
  return page.evaluate((name) => {
    const host = document.querySelector('sd-game');
    const ng = (
      globalThis as unknown as {
        ng?: { getComponent(el: Element): { state: Record<string, number> } };
      }
    ).ng;

    return host && ng ? (ng.getComponent(host).state[name] ?? null) : null;
  }, field);
}

test('desktop: enters the game, keys do not scroll, mute toggles, Esc exits', async ({ page }) => {
  await page.goto('/fr');

  // The player gamepad button enters game mode → the canvas mounts, the scene layer hides.
  await page.getByRole('button', { name: 'Lancer le jeu' }).click();
  await expect(page.locator('sd-game canvas.game__canvas')).toBeVisible();
  await expect(page.locator('sd-player-stage')).toHaveCount(0);
  await expect(page.locator('canvas.game__hud')).toBeVisible(); // the composited image HUD renders

  // Game keys must NOT scroll the page (preventDefault while in game mode).
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' ');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  // The music mute button toggles its accessible label (toHaveAttribute auto-waits for zoneless CD).
  // Music starts MUTED by default (no auto-play until the player opts in), so the button first offers
  // to ACTIVATE it; clicking turns it on and the label flips to "Couper la musique".
  const mute = page.locator('.game__mute');

  await expect(mute).toHaveAttribute('aria-label', 'Activer la musique');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-label', 'Couper la musique');

  // Esc returns to the video.
  await page.keyboard.press('Escape');
  await expect(page.locator('sd-game')).toHaveCount(0);
  await expect(page.locator('sd-player-stage')).toBeVisible();
});

test('desktop: exiting via the in-game exit button resumes the video (not stuck paused)', async ({
  page,
}) => {
  await page.goto('/fr');
  // The video auto-plays (player.playing() defaults true) → `.player` has no `is-paused`.
  await expect(page.locator('.player')).not.toHaveClass(/is-paused/);

  await page.getByRole('button', { name: 'Lancer le jeu' }).click();
  await expect(page.locator('sd-game canvas.game__canvas')).toBeVisible();
  await expect(page.locator('.player')).toHaveClass(/is-paused/); // entering pauses the video

  // Exit via the in-game button — the click must NOT bubble to the player's toggle-play, so the video
  // RESUMES (it was playing before). The regression: it stayed paused.
  await page.locator('.game__exit').click();
  await expect(page.locator('sd-player-stage')).toBeVisible();
  await expect(page.locator('.player')).not.toHaveClass(/is-paused/);
});

// STALE — pending the B4 assembler level. This asserts the OLD "sentinel turret down column 3" map, which
// `buildDemoLevel` (a descending-staircase verification map with the manager trapped in a pit behind a
// barrier) replaced. With the height-aware line-of-sight, that trapped manager correctly CANNOT hit the
// player, so "health drops below 100" no longer holds. Rewrite against the real generated level once the
// slot-grid assembler is wired into the run loop (B4).
test.fixme('desktop: advancing to the doorway puts the player in the sentinel line of fire (health drops below 100)', async ({
  page,
}) => {
  await page.goto('/fr');
  await page.getByRole('button', { name: 'Lancer le jeu' }).click();
  await expect(page.locator('sd-game canvas.game__canvas')).toBeVisible();

  const hp = (): Promise<number | null> => gameField(page, 'playerHp');

  // The spawn nook is sealed by construction — no enemy can ever see the spawn — so standing still keeps
  // the energy at full (the positive safe-spawn guarantee).
  await expect.poll(hp).toBe(100); // full energy on entry
  await page.waitForTimeout(1000);
  expect(await hp()).toBe(100); // still 100 at rest: nothing can reach the spawn

  // Advance +x along the pocket to the corner (3,1): the sentinel turret down column 3 now gains line
  // of sight up the throat and pelts the stationary player (the hit is position-based). Health drops
  // below 100.
  await page.keyboard.down('ArrowUp');
  await expect.poll(hp, { timeout: 6000 }).toBeLessThan(100);
  await page.keyboard.up('ArrowUp');
});
