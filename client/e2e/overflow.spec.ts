import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

// Every public route must have NO horizontal scroll at the 360px floor.
const routes = ['/fr', '/fr/articles', '/fr/series', '/fr/about', '/fr/stack', '/fr/contact'];

// Article bodies are content-dependent (long unbreakable code lines): guard EVERY
// detail page, in both languages (the bodies differ per language). Slugs are read from
// the content JSON so new articles are covered automatically.
const content = JSON.parse(
  readFileSync(join(__dirname, '../src/app/core/content/content.fr.json'), 'utf8'),
) as { articles: { slug: string }[] };
const articleRoutes = content.articles.flatMap(({ slug }) => [
  `/fr/articles/${slug}`,
  `/en/articles/${slug}`,
]);

test.use({ viewport: { width: 360, height: 800 } });

for (const route of routes) {
  test(`no horizontal overflow at 360px — ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement!;

      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });

    expect(overflow.scrollWidth, `horizontal overflow on ${route}`).toBeLessThanOrEqual(
      overflow.clientWidth,
    );
  });
}

test('no horizontal overflow at 360px — every article detail (fr + en)', async ({ page }) => {
  test.setTimeout(120_000);
  for (const route of articleRoutes) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement!;

      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });

    expect(overflow.scrollWidth, `horizontal overflow on ${route}`).toBeLessThanOrEqual(
      overflow.clientWidth,
    );
  }
});
