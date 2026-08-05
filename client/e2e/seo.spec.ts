import { test, expect } from '@playwright/test';

test('an article page exposes SEO metadata at runtime (title, OG, canonical, JSON-LD)', async ({
  page,
}) => {
  await page.goto('/fr/articles/etrangler-le-monolithe-dotnet');
  await page.waitForSelector('.article-detail__body');

  await expect(page).toHaveTitle(/super-dev\.app/);

  await expect(page.locator("meta[property='og:title']")).toHaveCount(1);
  await expect(page.locator("meta[property='og:type']")).toHaveAttribute('content', 'article');
  await expect(page.locator("link[rel='canonical']")).toHaveAttribute(
    'href',
    /\/fr\/articles\/etrangler-le-monolithe-dotnet$/,
  );
  await expect(page.locator("link[rel='alternate'][hreflang='en']")).toHaveCount(1);
  // One hreflang per Lang + x-default; one og:locale:alternate per OTHER language.
  await expect(page.locator("link[rel='alternate'][hreflang]")).toHaveCount(5);
  await expect(page.locator("meta[property='og:locale:alternate']")).toHaveCount(3);

  const jsonld = await page.locator('script#sd-jsonld').textContent();
  const graph = JSON.parse(jsonld ?? '{}')['@graph'] ?? [];
  const posting = graph.find((entity: { '@type': string }) => entity['@type'] === 'BlogPosting');
  const breadcrumb = graph.find(
    (entity: { '@type': string }) => entity['@type'] === 'BreadcrumbList',
  );

  expect(posting?.inLanguage).toBe('fr');
  expect(posting?.headline?.length ?? 0).toBeGreaterThan(0);
  // The meta description is the human-written entry description, not "TAG · title · read time".
  expect(posting?.description).not.toMatch(/·\s*\d+\s*min$/);
  expect(breadcrumb?.itemListElement?.length).toBe(3);
});

test('the home exposes the WebSite + Person JSON-LD graph, name-first', async ({ page }) => {
  await page.goto('/fr');
  await page.waitForSelector('.channel');

  // The home title leads with the NAME (the lever for a "Stéphane De Todaro" query).
  await expect(page).toHaveTitle(/^Stéphane De Todaro —/);

  const jsonld = await page.locator('script#sd-jsonld').textContent();
  const graph = JSON.parse(jsonld ?? '{}')['@graph'] ?? [];
  const types = graph.map((entity: { '@type': string }) => entity['@type']);

  expect(types).toEqual(['WebSite', 'Person']);
  // The WebSite is named after the person; the domain is the alternateName.
  expect(graph[0].name).toBe('Stéphane De Todaro');
  expect(graph[0].alternateName).toBe('super-dev.app');
  const person = graph.find((entity: { '@type': string }) => entity['@type'] === 'Person');

  expect(person['@id']).toBe('https://super-dev.app/#stephane');
});

test('the about page is the canonical ProfilePage (name-first title + shared Person @id + real links)', async ({
  page,
}) => {
  await page.goto('/fr/about');
  await page.waitForSelector('.about-bio');

  await expect(page).toHaveTitle(/^Stéphane De Todaro —/);

  const jsonld = await page.locator('script#sd-jsonld').textContent();
  const graph = JSON.parse(jsonld ?? '{}')['@graph'] ?? [];
  const types = graph.map((entity: { '@type': string }) => entity['@type']);

  expect(types).toEqual(['WebSite', 'ProfilePage', 'Person']);
  const profile = graph.find((entity: { '@type': string }) => entity['@type'] === 'ProfilePage');
  const person = graph.find((entity: { '@type': string }) => entity['@type'] === 'Person');

  // Same @id on the home Person, the article authors and here → one folded entity.
  expect(profile.mainEntity['@id']).toBe(person['@id']);
  expect(person['@id']).toBe('https://super-dev.app/#stephane');

  // The identity links are real hrefs now, not dead href="#".
  await expect(page.locator(".about-side__links a[href='https://github.com/Nayruuu']")).toHaveCount(
    1,
  );
  // The visible LinkedIn link uses the exact canonical `sameAs` form (www + percent-encoded), not
  // the raw display label — so the visible link and the JSON-LD identity anchor never diverge.
  const linkedin = person.sameAs.find((url: string) => url.includes('linkedin.com'));

  await expect(page.locator(`.about-side__links a[href='${linkedin}']`)).toHaveCount(1);
});

test('a project page exposes SoftwareSourceCode JSON-LD authored by the canonical Person', async ({
  page,
}) => {
  await page.goto('/fr/projects/ngsharp');
  await page.waitForSelector('.proj-detail');

  await expect(page).toHaveTitle(/^NgSharp/);

  const jsonld = await page.locator('script#sd-jsonld').textContent();
  const graph = JSON.parse(jsonld ?? '{}')['@graph'] ?? [];
  const code = graph.find(
    (entity: { '@type': string }) => entity['@type'] === 'SoftwareSourceCode',
  );

  expect(code.codeRepository).toBe('https://github.com/Nayruuu/NgSharp');
  expect(code.programmingLanguage).toBe('C#');
  // Authored by the ONE folded entity — the embedded Person carries the shared @id (same as home /
  // about / every article author), the whole point of the entity unification.
  expect(code.author['@id']).toBe('https://super-dev.app/#stephane');
  expect(graph.some((entity: { '@type': string }) => entity['@type'] === 'BreadcrumbList')).toBe(
    true,
  );

  // Real external resource + the on-site article link (concise landing that links, never duplicates).
  await expect(
    page.locator(".proj-detail__link[href='https://www.nuget.org/packages/NgSharp']"),
  ).toHaveCount(1);
  await expect(
    page.locator(".proj-detail__link[href='/fr/articles/ngsharp-moteur-templates-interprete']"),
  ).toHaveCount(1);
});

test('the projects list is a CollectionPage, and is reachable from the /about "Projets" card', async ({
  page,
}) => {
  await page.goto('/fr/projects');
  await page.waitForSelector('.proj-list');

  const jsonld = await page.locator('script#sd-jsonld').textContent();
  const types = (JSON.parse(jsonld ?? '{}')['@graph'] ?? []).map(
    (entity: { '@type': string }) => entity['@type'],
  );

  expect(types).toContain('CollectionPage');
  expect(types).toContain('Person');
  // One card per published project.
  await expect(page.locator('.proj-card')).toHaveCount(4);

  await page.goto('/fr/about');
  await page.waitForSelector('.about-bio');
  await expect(page.locator(".about-side__links a[href='/fr/projects']")).toHaveCount(1);
});
