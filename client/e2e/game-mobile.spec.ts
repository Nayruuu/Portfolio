import { test, expect, devices, type Page } from '@playwright/test';

// `isMobile`/`hasTouch` (and the resulting `pointer: coarse`) must be set at the file level, so the
// mobile game case is its own spec (like `prefs-dock`). Runs under the chromium project with Pixel 5
// emulation; the `mobile` project's `testMatch` only picks up the visual specs.
test.use({ ...devices['Pixel 5'] });

/** Read a live numeric field off the game state. The HUD is now a single canvas (no DOM text), so we
 *  reach the component instance through Angular's dev-mode `ng` global instead of scraping the bar. */
function gameField<T = number>(page: Page, field: string): Promise<T | null> {
  return page.evaluate((name) => {
    const host = document.querySelector('sd-game');
    const ng = (
      globalThis as unknown as {
        ng?: { getComponent(el: Element): { state: Record<string, unknown> } };
      }
    ).ng;

    return host && ng ? (ng.getComponent(host).state[name] ?? null) : null;
  }, field) as Promise<T | null>;
}

test('mobile: entering the game shows the dual-thumb touch overlay (coarse pointer)', async ({
  page,
}) => {
  await page.goto('/fr');
  await page.getByRole('button', { name: 'Lancer le jeu' }).click();

  await expect(page.locator('sd-game canvas.game__canvas')).toBeVisible();
  // The `@media (pointer: coarse)` rule reveals the joystick + look zones on a touch device.
  await expect(page.locator('.game__joystick')).toBeVisible();
  await expect(page.locator('.game__look')).toBeVisible();

  // Touching the joystick zone spawns the visible floating joystick under the thumb.
  await expect(page.locator('.game__stick')).toHaveCount(0);
  const zone = page.locator('.game__joystick');
  const box = await zone.boundingBox();

  await zone.dispatchEvent('touchstart', {
    changedTouches: [{ identifier: 1, clientX: box!.x + 60, clientY: box!.y + 60 }],
    touches: [{ identifier: 1, clientX: box!.x + 60, clientY: box!.y + 60 }],
  });
  await expect(page.locator('.game__stick')).toBeVisible();
});

// STALE — pending the B4 assembler level. Like its desktop twin, this drives the OLD "sentinel printer down
// column 3" map; `buildDemoLevel` replaced it with a descending staircase whose manager is trapped in a pit
// behind a barrier and cannot be reached for a melee kill. Rewrite once the slot-grid assembler is wired in.
test.fixme('mobile: advancing into melee range and swinging the keyboard registers a kill on the sentinel', async ({
  page,
}) => {
  await page.goto('/fr');
  await page.getByRole('button', { name: 'Lancer le jeu' }).click();
  await expect(page.locator('sd-game canvas.game__canvas')).toBeVisible();

  const kills = (): Promise<number | null> => gameField(page, 'kills');

  await expect.poll(kills).toBe(0); // no kills on entry

  // The keyboard is MELEE (`contact` reach ≈ 1.3 cells, 25 dmg, 0.8 s swing cadence) — the gun is gone —
  // so the player must close on the sentinel printer parked straight down column 3, not pelt it from the
  // doorway. Pixel 5 is portrait, so the overlay is CSS-rotated 90° and `localPoint` swaps the axes: a
  // joystick drag in screen +x is FORWARD, in screen −x is BACK, and a look drag in screen +y turns the
  // heading toward world +y (down the throat). See `game-input.ts`.
  const joystick = page.locator('.game__joystick');
  const jbox = await joystick.boundingBox();
  const jx = jbox!.x + jbox!.width / 2;
  const jy = jbox!.y + jbox!.height / 2;

  // (1) Full-deflection forward to the corner — the player pins against the wall at the head of the throat
  //     (column 3's east wall → x ≈ 3.8).
  await joystick.dispatchEvent('touchstart', {
    changedTouches: [{ identifier: 1, clientX: jx, clientY: jy }],
    touches: [{ identifier: 1, clientX: jx, clientY: jy }],
  });
  await joystick.dispatchEvent('touchmove', {
    changedTouches: [{ identifier: 1, clientX: jx + 60, clientY: jy }],
    touches: [{ identifier: 1, clientX: jx + 60, clientY: jy }],
  });
  await page.waitForTimeout(800); // travel to the corner
  await joystick.dispatchEvent('touchend', {
    changedTouches: [{ identifier: 1, clientX: jx + 60, clientY: jy }],
    touches: [],
  });

  // (1b) CENTRE the column: a short BACK nudge (screen −x → forward ≈ −0.3 from the known wall-pin) slides
  //      the player west off the east wall to x ≈ 3.5 — dead-centre of the 1-wide throat, aligned in x with
  //      the printer at (3.5, 9.5). With the printer straight ahead the melee cone stays satisfied all the
  //      way in, so the in-reach window is the FULL `contact` reach (≈ 1.3 cells), not the sliver an
  //      off-axis wall-hug leaves — robust against the slower 0.8 s cadence.
  await joystick.dispatchEvent('touchstart', {
    changedTouches: [{ identifier: 4, clientX: jx, clientY: jy }],
    touches: [{ identifier: 4, clientX: jx, clientY: jy }],
  });
  await joystick.dispatchEvent('touchmove', {
    changedTouches: [{ identifier: 4, clientX: jx - 15, clientY: jy }],
    touches: [{ identifier: 4, clientX: jx - 15, clientY: jy }],
  });
  await page.waitForTimeout(300); // ≈ 0.3 cell west → x ≈ 3.5
  await joystick.dispatchEvent('touchend', {
    changedTouches: [{ identifier: 4, clientX: jx - 15, clientY: jy }],
    touches: [],
  });

  // (2) Turn ~90° toward world +y — a look drag of ≈ (π/2) / LOOK_SENSITIVITY (628 px, SENS = 0.0025).
  const look = page.locator('.game__look');
  const lbox = await look.boundingBox();
  const lx = lbox!.x + lbox!.width / 2;
  const ly = lbox!.y + 20;

  await look.dispatchEvent('touchstart', {
    changedTouches: [{ identifier: 2, clientX: lx, clientY: ly }],
    touches: [{ identifier: 2, clientX: lx, clientY: ly }],
  });
  await look.dispatchEvent('touchmove', {
    changedTouches: [{ identifier: 2, clientX: lx, clientY: ly + 628 }],
    touches: [{ identifier: 2, clientX: lx, clientY: ly + 628 }],
  });
  await look.dispatchEvent('touchend', {
    changedTouches: [{ identifier: 2, clientX: lx, clientY: ly + 628 }],
    touches: [],
  });

  // (3) Brisk descent down the centred throat (a ~18 px / ≈ 0.37 deflection → ≈ 1.2 cell/s), held
  // throughout while the fire button is tapped (every 200 ms). Two forces are balanced: the pace is QUICK
  // enough to keep the player out of death's reach — the turret throws on a ~1.7 s cycle (1.2 s cooldown +
  // 0.5 s wind-up), so the ~6 s approach eats only ~4 throws and the player holds ≈ 50 of 100 HP — yet the
  // dead-centre alignment keeps the printer in-cone across the WHOLE ≈ 1.3-cell reach window (≈ 1.1 s at
  // this pace), so a swing's strike frame still lands inside it. One landed swing (25 dmg) one-shots the
  // 6-hp printer → a kill (empirically ≈ shot 28, at y ≈ 8.9, well before the budget runs out).
  await joystick.dispatchEvent('touchstart', {
    changedTouches: [{ identifier: 3, clientX: jx, clientY: jy }],
    touches: [{ identifier: 3, clientX: jx, clientY: jy }],
  });
  await joystick.dispatchEvent('touchmove', {
    changedTouches: [{ identifier: 3, clientX: jx + 18, clientY: jy }],
    touches: [{ identifier: 3, clientX: jx + 18, clientY: jy }],
  });

  const fireButton = page.locator('.game__fire');

  for (let shot = 0; shot < 44 && (await kills()) === 0; shot++) {
    await fireButton.dispatchEvent('touchstart');
    await page.waitForTimeout(200); // keep swinging as the player closes on the sentinel
  }

  await expect.poll(kills).toBeGreaterThan(0); // a melee swing landed → the sentinel dropped
});

test('mobile: a keyboard swing spends no ammo (the melee weapon is ammo-less)', async ({
  page,
}) => {
  await page.goto('/fr');
  await page.getByRole('button', { name: 'Lancer le jeu' }).click();
  await expect(page.locator('sd-game canvas.game__canvas')).toBeVisible();

  // The keyboard has no ammo type, so swinging never decrements ANY per-type reserve (the HUD shows no ammo
  // digits for it). This is the behavioural inverse of the old "firing spends ammo" gun test.
  const ammo = (): Promise<Record<string, number> | null> =>
    gameField<Record<string, number>>(page, 'playerAmmo');

  // Wait for the per-type reserves to seed, capture them, then prove a melee swing leaves them untouched.
  await expect.poll(async () => Object.keys((await ammo()) ?? {}).length).toBeGreaterThan(0);
  const before = await ammo();
  const fireButton = page.locator('.game__fire');

  for (let shot = 0; shot < 6; shot++) {
    await fireButton.dispatchEvent('touchstart');
    await page.waitForTimeout(300); // tap the fire button repeatedly (some taps swing, some hit cooldown)
  }

  await expect.poll(ammo).toEqual(before); // unchanged — a melee swing costs no ammo whether or not it lands
});
