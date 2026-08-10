import { test, expect } from '@playwright/test';

/**
 * iOS Safari (WebKit) regression net for the player. The mobile visual baselines run on
 * Chromium (Pixel 5 device emulation), so engine-specific WebKit bugs are invisible there —
 * e.g. WebKit miscomputing a container-query unit nested in `atan2()`, which scaled the
 * "downscaled-video" scenes by a negative factor and blanked the player on iPhone.
 * This spec drives the real WebKit engine (run under the `webkit` project).
 */
test('the scaled player scene renders inside the player on WebKit/iOS', async ({ page }) => {
  await page.goto('/fr');

  const fit = page.locator('.scene--fit.scene--on');

  await expect(fit).toBeVisible();

  // The `.scene--fit` scale must be a sane downscale (positive, < 1.2 at phone width),
  // not the negative blow-up (`scale(-2.8)`) WebKit produced from `atan2(100cqw, …)`.
  const scaleX = await fit.evaluate(
    (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a,
  );

  expect(scaleX).toBeGreaterThan(0);
  expect(scaleX).toBeLessThan(1.2);

  // And the scaled scene must sit within the player box, not be pushed off-screen.
  const fitBox = await fit.boundingBox();
  const playerBox = await page.locator('.player').boundingBox();

  expect(fitBox).not.toBeNull();
  expect(playerBox).not.toBeNull();
  expect(fitBox!.x).toBeGreaterThanOrEqual(playerBox!.x - 2);
  expect(fitBox!.x + fitBox!.width).toBeLessThanOrEqual(playerBox!.x + playerBox!.width + 2);
});

test('rotates the fallback fullscreen to landscape in portrait on iOS', async ({ page }) => {
  // Force the CSS-fallback path (no native fullscreen on the simulated <div> player), so the
  // forced-landscape rotation — iPhone Safari has no `orientation.lock` — is exercised.
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
  });
  await page.goto('/fr');

  const player = page.locator('.player');

  await player.getByRole('button', { name: 'Plein écran' }).click();
  await expect(player).toHaveClass(/is-fullscreen/);

  // The player is rotated 90° (rotation matrix: a ≈ 0, |b| ≈ 1) to fill the upright phone.
  const matrix = await player.evaluate((el) => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(el).transform);

    return { a: transform.a, b: transform.b };
  });

  expect(Math.abs(matrix.a)).toBeLessThan(0.01);
  expect(Math.abs(matrix.b)).toBeGreaterThan(0.99);
});
