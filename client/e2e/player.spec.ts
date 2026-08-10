import { test, expect } from '@playwright/test';

test('the player responds to play/pause', async ({ page }) => {
  await page.goto('/');

  // Auto-plays on load → the control button exposes the i18n'd pause label (FR default "Pause").
  const pauseBtn = page.locator('.player__btn[aria-label="Pause"]');

  await expect(pauseBtn).toBeVisible();
  await pauseBtn.click();

  // When paused → the same button switches to the i18n'd play label (FR default "Lecture").
  await expect(page.locator('.player__btn[aria-label="Lecture"]')).toBeVisible();
});

test('the advertised `k` keyboard shortcut toggles play/pause', async ({ page }) => {
  await page.goto('/fr');

  // Auto-plays → "Pause" exposed; pressing `k` (the keys-hint shortcut) must pause it.
  await expect(page.locator('.player__btn[aria-label="Pause"]')).toBeVisible();
  await page.locator('body').press('k');
  await expect(page.locator('.player__btn[aria-label="Lecture"]')).toBeVisible();

  // …and `k` again resumes — proving the handler is wired both ways.
  await page.locator('body').press('k');
  await expect(page.locator('.player__btn[aria-label="Pause"]')).toBeVisible();
});

test('the full button toggles native fullscreen', async ({ page }) => {
  await page.goto('/fr');

  // At rest only the enter label exists ("Plein écran"); the exit label appears once fullscreen.
  await page.getByRole('button', { name: 'Plein écran' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);

  // Esc-exits-native-fullscreen is a browser-process keybinding that synthesized keys never
  // reach in headless Chromium, so exit through the toggled button (same app code path —
  // `fullscreenchange` syncs the signal either way).
  await page.getByRole('button', { name: 'Quitter le plein écran' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(false);
});

test('seeking the timeline lands mid-typing deterministically', async ({ page }) => {
  await page.goto('/fr');
  // Jump into the stack chapter (00:15); the sequential body chain is then in flight.
  await page.locator('.chap', { hasText: '00:15' }).click();

  // One atomic in-page sample per read — a locator chain would race the ~25ms-per-character
  // typing between resolving the caret-bearing element and reading its shown/ghost spans.
  const sampleTyping = () =>
    page.evaluate(() => {
      const carets = document.querySelectorAll('.scene--on .typed__caret');
      const host = carets[0]?.closest('sd-typed');

      return {
        caretCount: carets.length,
        shownLength: host?.querySelector('.typed__shown')?.textContent?.length ?? 0,
        ghostLength: host?.querySelector('.typed__ghost')?.textContent?.length ?? 0,
      };
    });

  // STRICTLY sequential: settle on exactly one caret whose element shows a non-empty strict
  // prefix (mid-frappe) — both shown and ghost halves non-empty in the same DOM snapshot.
  await expect
    .poll(async () => {
      const sample = await sampleTyping();

      return sample.caretCount === 1 && sample.shownLength > 0 && sample.ghostLength > 0;
    })
    .toBe(true);

  // Sample the sequential invariant a few times while it plays: 0 or 1 caret, never 2+.
  for (let round = 0; round < 5; round++) {
    expect((await sampleTyping()).caretCount).toBeLessThanOrEqual(1);
    await page.waitForTimeout(200);
  }
});

test('Escape exits the CSS-fallback fullscreen', async ({ page }) => {
  // Force the iOS-style fallback (no native Fullscreen API on the simulated player) so the
  // component's own Escape handler — not the browser keybinding — owns the exit.
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
  });
  await page.goto('/fr');

  const player = page.locator('.player');

  await page.getByRole('button', { name: 'Plein écran' }).click();
  await expect(player).toHaveClass(/is-fullscreen/);

  await page.keyboard.press('Escape');
  await expect(player).not.toHaveClass(/is-fullscreen/);
});

test('the pip button pops the player into a floating mini-player, restorable', async ({ page }) => {
  await page.goto('/fr');
  await expect(page.locator('.mini-player')).toHaveCount(0);

  // The ⛶ pip button (FR aria "Mini-lecteur") detaches the player into the floating mini.
  await page.getByRole('button', { name: 'Mini-lecteur' }).click();
  await expect(page.locator('.mini-player')).toBeVisible();
  await expect(page.locator('.mini-player .scene--on').first()).toBeVisible(); // live scenes inside
  await expect(page.locator('.player__popped')).toBeVisible(); // inline shows the placeholder

  // Pause first so the typing scenes stop churning the DOM during the seek interaction.
  await page.locator('.mini-player').getByRole('button', { name: 'Pause' }).click();

  // The seekable playback bar: clicking near the end seeks the fill toward that position.
  const bar = page.locator('.mini-player__progress');
  const box = (await bar.boundingBox())!;

  await bar.click({ position: { x: box.width * 0.85, y: 5 } });
  await expect
    .poll(() =>
      page
        .locator('.mini-player__progress-fill')
        .evaluate(
          (el) =>
            (el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width) *
            100,
        ),
    )
    .toBeGreaterThan(70);

  // Restore from the mini's button (scoped — the inline placeholder shares the label).
  await page.locator('.mini-player').getByRole('button', { name: 'Revenir au lecteur' }).click();
  await expect(page.locator('.mini-player')).toHaveCount(0);
  await expect(page.locator('.player__popped')).toHaveCount(0);
});
