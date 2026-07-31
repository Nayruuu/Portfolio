import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { SeoService } from './seo.service';
import { DEFAULT_OG_IMAGE, SOCIAL_URLS } from '../../lib';

function cleanHead(doc: Document): void {
  doc.title = '';
  doc.head
    .querySelectorAll(
      "meta[name], meta[property], link[rel='canonical'], link[data-seo='hreflang'], #sd-jsonld",
    )
    .forEach((element) => element.remove());
}

describe('SeoService', () => {
  let seo: SeoService;
  let doc: Document;
  const base = { title: 'T', description: 'D', path: '/fr/articles/2', lang: 'fr' as const };
  const crumbs = [
    { name: 'Accueil', path: '/fr' },
    { name: 'Articles', path: '/fr/articles' },
    { name: 'T', path: '/fr/articles/2' },
  ];

  beforeEach(() => {
    seo = TestBed.inject(SeoService);
    doc = TestBed.inject(DOCUMENT);
    cleanHead(doc);
  });

  it('update() sets title, description, canonical, 5 hreflang, and default og image+type', () => {
    seo.update(base);

    expect(doc.title).toBe('T');
    expect(doc.querySelector("meta[name='description']")?.getAttribute('content')).toBe('D');
    expect(doc.querySelector("meta[property='og:type']")?.getAttribute('content')).toBe('website');
    expect(doc.querySelector("meta[property='og:image']")?.getAttribute('content')).toBe(
      DEFAULT_OG_IMAGE,
    );
    expect(doc.querySelector("link[rel='canonical']")?.getAttribute('href')).toBe(
      'https://super-dev.app/fr/articles/2',
    );
    const langs = Array.from(
      doc.querySelectorAll("link[rel='alternate'][data-seo='hreflang']"),
    ).map((link) => link.getAttribute('hreflang'));

    expect(langs).toEqual(['fr', 'en', 'es', 'de', 'x-default']);
    // og:locale:alternate — one per OTHER language (en, es, de).
    expect(doc.querySelectorAll("meta[property='og:locale:alternate']").length).toBe(3);
  });

  it('honors explicit image + article type, and re-running replaces (no duplicates)', () => {
    seo.update(base); // create branches
    seo.update({ ...base, image: 'https://x/y.png', type: 'article' }); // exists branches + provided

    expect(doc.querySelectorAll("meta[name='description']").length).toBe(1);
    expect(doc.querySelectorAll("link[rel='canonical']").length).toBe(1);
    expect(doc.querySelectorAll("link[rel='alternate'][data-seo='hreflang']").length).toBe(5);
    expect(doc.querySelector("meta[property='og:type']")?.getAttribute('content')).toBe('article');
    expect(doc.querySelector("meta[property='og:image']")?.getAttribute('content')).toBe(
      'https://x/y.png',
    );
  });

  it('setArticleJsonLd() injects a BlogPosting + BreadcrumbList graph and replaces on re-run', () => {
    seo.setArticleJsonLd(
      {
        ...base,
        type: 'article',
        image: 'https://x/y.png',
        datePublished: '2026-01-01',
        dateModified: '2026-01-02',
      },
      crumbs,
    );
    let graph = JSON.parse(doc.getElementById('sd-jsonld')!.textContent!)['@graph'];
    const posting = graph[0];

    expect(posting['@type']).toBe('BlogPosting');
    expect(posting.headline).toBe('T');
    expect(posting.inLanguage).toBe('fr');
    expect(posting.image).toEqual(['https://x/y.png']);

    const breadcrumb = graph[1];

    expect(breadcrumb['@type']).toBe('BreadcrumbList');
    expect(breadcrumb.itemListElement.map((item: { position: number }) => item.position)).toEqual([
      1, 2, 3,
    ]);
    expect(breadcrumb.itemListElement[2].item).toBe('https://super-dev.app/fr/articles/2');

    seo.setArticleJsonLd(
      { ...base, datePublished: '2026-02-01', dateModified: '2026-02-02' },
      crumbs,
    );
    expect(doc.querySelectorAll('#sd-jsonld').length).toBe(1);
    graph = JSON.parse(doc.getElementById('sd-jsonld')!.textContent!)['@graph'];
    expect(graph[0].datePublished).toBe('2026-02-01');
    expect(graph[0].image).toEqual([DEFAULT_OG_IMAGE]);
  });

  it('setSiteJsonLd() injects the WebSite + Person graph with the social profiles', () => {
    seo.setSiteJsonLd('fr');
    const graph = JSON.parse(doc.getElementById('sd-jsonld')!.textContent!)['@graph'];

    expect(graph[0]['@type']).toBe('WebSite');
    expect(graph[0].inLanguage).toBe('fr');
    expect(graph[1]['@type']).toBe('Person');
    expect(graph[1].sameAs).toEqual([...SOCIAL_URLS]);
  });

  it('clearJsonLd() removes the script when present and is a no-op otherwise', () => {
    seo.setArticleJsonLd(
      { ...base, datePublished: '2026-01-01', dateModified: '2026-01-02' },
      crumbs,
    );
    expect(doc.getElementById('sd-jsonld')).toBeTruthy();

    seo.clearJsonLd();
    expect(doc.getElementById('sd-jsonld')).toBeNull();
    expect(() => seo.clearJsonLd()).not.toThrow();
  });
});
