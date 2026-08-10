import { expect, test } from '@playwright/test';

// The WebGPU compute backend must render pixel-faithfully to the reference CPU renderer — that equivalence is
// what lets the game ship a GPU accelerator without a second, divergent renderer. This probe drives the
// localhost `__bspRenderParity` hook, which renders ONE scene through both backends into private buffers and
// diffs them. It runs for real only where the browser exposes WebGPU (a GPU browser or a WebGPU-enabled CI
// runner); Playwright's headless chromium strips `navigator.gpu`, so there the hook returns `available:false`
// and the test SKIPS — it never silently degrades into a meaningless CPU-vs-CPU comparison.
// Mirrors RenderParityResult (render-host.ts) — kept in sync by hand; the e2e tsconfig can't cheaply reach
// into the Angular module graph to import it.
type ParityResult =
  | { readonly available: false; readonly reason: string }
  | {
      readonly available: true;
      readonly width: number;
      readonly height: number;
      readonly tolerance: number;
      readonly maxChannelDiff: number;
      readonly mismatchCount: number;
      readonly pixelCount: number;
    };

test('WebGPU and CPU backends render the same scene within f32 tolerance', async ({ page }) => {
  await page.goto('/bsp');
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __bspRenderParity?: unknown }).__bspRenderParity ===
      'function',
    undefined,
    { timeout: 15_000 },
  );

  const result = await page.evaluate((): Promise<ParityResult> => {
    const hook = (window as unknown as { __bspRenderParity?: () => Promise<ParityResult> })
      .__bspRenderParity;

    return hook?.() ?? Promise.resolve<ParityResult>({ available: false, reason: 'hook missing' });
  });

  if (!result.available) {
    test.skip(
      true,
      `WebGPU unavailable in this browser (${result.reason}) — GPU↔CPU parity not exercised`,
    );

    return;
  }

  // Surface the real deltas so a WebGPU run's numbers are visible in the report (and the 2% bound below is
  // calibratable against them). A faithful backend differs only by f32 rounding at a few texel boundaries; a
  // broken one diverges across ~the whole frame.
  test.info().annotations.push({
    type: 'gpu-cpu-parity',
    description:
      `${result.width}×${result.height} · tolerance=${result.tolerance} · ` +
      `maxChannelDiff=${result.maxChannelDiff} · mismatch=${result.mismatchCount}/${result.pixelCount}`,
  });

  expect(result.mismatchCount / result.pixelCount).toBeLessThan(0.02);
});
