import { test, expect } from '@playwright/test';

// WebKit-only (the `webkit` project, iPhone 13). The game forces landscape on a phone — in portrait it
// CSS-rotates the overlay 90° and compensates the touch coordinates via `localPoint`, so the controls
// stay correct (the naïve reuse of the video rotation, without compensation, made it unplayable).

test('iOS landscape: the game is a non-rotated fixed overlay, the joystick lands at the touch point', async ({
  page,
}) => {
  await page.setViewportSize({ width: 750, height: 360 }); // a phone held in landscape
  await page.goto('/fr');
  await page.getByRole('button', { name: 'Lancer le jeu' }).click();
  await expect(page.locator('sd-game canvas.game__canvas')).toBeVisible();

  // The bug was the iOS 90° rotation. The game must NOT be rotated, and it fills the viewport.
  const player = page.locator('.player');

  await expect(player).toHaveCSS('transform', 'none');
  await expect(player).toHaveCSS('position', 'fixed');

  // No long-press text selection while dragging the controls (iOS reflects the `-webkit-` property).
  await expect(page.locator('.game')).toHaveCSS('-webkit-user-select', 'none');

  // A touch on the joystick zone spawns the visible stick **centred at the touch point** (a rotation
  // offset would put it elsewhere — this is the regression guard).
  const box = await page.locator('.game__joystick').boundingBox();
  const touchX = Math.round(box!.x + 100);
  const touchY = Math.round(box!.y + 50);

  await page.locator('.game__joystick').dispatchEvent('touchstart', {
    changedTouches: [{ identifier: 1, clientX: touchX, clientY: touchY }],
    touches: [{ identifier: 1, clientX: touchX, clientY: touchY }],
  });

  const stick = await page.locator('.game__stick').boundingBox();

  expect(Math.abs(stick!.x + stick!.width / 2 - touchX)).toBeLessThan(4);
  expect(Math.abs(stick!.y + stick!.height / 2 - touchY)).toBeLessThan(4);
});

test('iOS portrait: forced landscape — the overlay is rotated 90°, the joystick still lands at the touch', async ({
  page,
}) => {
  // The default webkit project viewport is iPhone 13 portrait. The game forces landscape by CSS-rotating
  // the overlay 90°, and `localPoint()` compensates the touch coordinates — so the stick must still land
  // under the thumb (in screen space) despite the rotation.
  await page.goto('/fr');
  await page.getByRole('button', { name: 'Lancer le jeu' }).click();
  await expect(page.locator('sd-game canvas.game__canvas')).toBeVisible();

  const player = page.locator('.player');

  await expect(player).toHaveCSS('position', 'fixed');
  // Rotated to landscape (NOT `none`) — a 90° rotation matrix.
  const transform = await player.evaluate((el) => getComputedStyle(el).transform);

  expect(transform).not.toBe('none');

  const box = await page.locator('.game__joystick').boundingBox();
  const touchX = Math.round(box!.x + box!.width / 2);
  const touchY = Math.round(box!.y + box!.height / 2);

  await page.locator('.game__joystick').dispatchEvent('touchstart', {
    changedTouches: [{ identifier: 1, clientX: touchX, clientY: touchY }],
    touches: [{ identifier: 1, clientX: touchX, clientY: touchY }],
  });

  const stick = await page.locator('.game__stick').boundingBox();

  expect(Math.abs(stick!.x + stick!.width / 2 - touchX)).toBeLessThan(4);
  expect(Math.abs(stick!.y + stick!.height / 2 - touchY)).toBeLessThan(4);
});
