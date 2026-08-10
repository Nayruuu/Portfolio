import { test, expect } from '@playwright/test';

/**
 * The player's clock is SIMULATED (`PlayerService` drives `elapsed`), so a paused seek renders a
 * deterministic frozen frame — the five scenes get real visual baselines despite being animated
 * (the page-level `visual.spec.ts` masks `.player` for exactly that animation reason).
 * Each target sits ≥1.5s AFTER the scene's typing settles and BEFORE its chapter flips, so the
 * ±1px progress-bar click jitter can never land mid-typing. The screenshot targets the STAGE
 * (`sd-player-stage`), not `.player`: the control row's time readout / progress fill DO shift
 * with that same click jitter and would flake the comparison.
 */
const TOTAL_SEC = 160;
// Markers target the FOCUSED element: the phone "montage" hides every card but `.is-focus`,
// so a bare card selector would resolve hidden on mobile (and only pass by render-race luck).
const SCENES = [
  { name: 'intro', at: 13.5, marker: '.metric' },
  { name: 'stack', at: 50.5, marker: '.stack-card.is-focus' },
  { name: 'projects', at: 101.5, marker: '.proj-card.is-focus' },
  { name: 'timeline', at: 145, marker: '.tl-rich__row.is-focus' },
  { name: 'outro', at: 158.5, marker: '.scene-outro__link' },
];

for (const scene of SCENES) {
  test(`visual — scene ${scene.name}`, async ({ page }) => {
    await page.goto('/fr');
    const player = page.locator('.player');

    await player.waitFor();

    // 'k' can be swallowed while the app boots: retry until the toggle button's aria-label
    // flips to "Lecture" (= paused → the simulated clock is frozen). Attachment, not
    // visibility: the LIVE/PAUSED badge and controls are hidden on phone layouts.
    await expect(async () => {
      await page.keyboard.press('k');
      await expect(page.locator('.player [aria-label="Lecture"]').first()).toBeAttached({
        timeout: 1000,
      });
    }).toPass({ timeout: 15_000 });
    const bar = page.locator('.player__progress');

    await bar.waitFor({ state: 'visible' });
    // The boot overlay can swallow an early click, and the bar's geometry can shift while the
    // page settles: retry the whole wake → fresh-measure → click sequence until the target
    // scene's marker proves the jump landed, THEN freeze the frame.
    await expect(async () => {
      // Wake the controls: while playing+idle they fade to pointer-events:none and a click
      // would bounce (the player's own `(mousemove)="wake()"` hook).
      await player.hover();
      const box = await bar.boundingBox();

      if (!box) {
        throw new Error('progress bar not measurable');
      }
      await bar.click({ position: { x: (box.width * scene.at) / TOTAL_SEC, y: box.height / 2 } });
      await expect(page.locator(scene.marker).first()).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);

    // The controls strip (and its hover tooltip) overlays the stage box, and its auto-hide
    // fade clock varies with the seek retries — mask it instead of racing it. The scene
    // content above the strip is the thing under test.
    await expect(page.locator('sd-player-stage')).toHaveScreenshot(`scene-${scene.name}.png`, {
      mask: [page.locator('.player__controls')],
    });
  });
}
