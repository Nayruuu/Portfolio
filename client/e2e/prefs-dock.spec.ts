import { test, expect, devices } from '@playwright/test';

// The theme + language dock is mobile-only (the desktop nav hosts these at `md`+), so emulate a phone
// regardless of project. Like `bottom-nav`/`overflow`, this runs under the `chromium` project (which
// runs every non-iOS spec); the `mobile` project's `testMatch` only picks up the visual specs.
test.use({ ...devices['Pixel 5'] });

test('the mobile dock language picker opens upward, on-screen, and switches language', async ({
  page,
}) => {
  await page.goto('/fr');

  const toggle = page.locator('.prefs-dock .prefs__lang-toggle');

  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText(/FR/);

  await toggle.click();

  const menu = page.locator('.prefs-dock .prefs__lang-menu');

  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio')).toHaveCount(4);

  // Regression net: the dock sits at the bottom, so the menu must open UPWARD (its full height above
  // the toggle) and stay fully on-screen. The bug this guards: a CSS specificity tie left both `top`
  // and `bottom` set, collapsing the menu to a ~10px sliver that spilled downward off the bottom edge
  // behind the fixed tab bar.
  const menuBox = await menu.boundingBox();
  const toggleBox = await toggle.boundingBox();

  expect(menuBox).not.toBeNull();
  expect(toggleBox).not.toBeNull();
  // Menu bottom edge sits at/above the toggle's top → it opened upward.
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(toggleBox!.y + 1);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0); // top stays on-screen
  expect(menuBox!.height).toBeGreaterThan(80); // full height (4 items), not a collapsed sliver

  await page.locator('.prefs-dock').getByRole('menuitemradio', { name: 'EN' }).click();

  await expect(page).toHaveURL(/\/en$/);
  await expect(menu).toBeHidden();
  await expect(toggle).toHaveText(/EN/);
});
