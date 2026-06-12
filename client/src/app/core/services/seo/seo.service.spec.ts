import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { SeoService } from './seo.service';
import { DEFAULT_OG_IMAGE } from '../../lib';

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

  beforeEach(() => {
    seo = TestBed.inject(SeoService);
    doc = TestBed.inject(DOCUMENT);
    cleanHead(doc);
  });

  it('update() sets title, description, canonical, 3 hreflang, and default og image+type', () => {
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

    expect(langs).toEqual(['fr', 'en', 'x-default']);
  });

  it('honors explicit image + article type, and re-running replaces (no duplicates)', () => {
    seo.update(base); // create branches
    seo.update({ ...base, image: 'https://x/y.png', type: 'article' }); // exists branches + provided

    expect(doc.querySelectorAll("meta[name='description']").length).toBe(1);
    expect(doc.querySelectorAll("link[rel='canonical']").length).toBe(1);
    expect(doc.querySelectorAll("link[rel='alternate'][data-seo='hreflang']").length).toBe(3);
    expect(doc.querySelector("meta[property='og:type']")?.getAttribute('content')).toBe('article');
    expect(doc.querySelector("meta[property='og:image']")?.getAttribute('content')).toBe(
      'https://x/y.png',
    );
  });

  it('setArticleJsonLd() injects a valid BlogPosting and replaces on re-run', () => {
    seo.setArticleJsonLd({
      ...base,
      type: 'article',
      image: 'https://x/y.png',
      datePublished: '2026-01-01',
      dateModified: '2026-01-02',
    });
    let data = JSON.parse(doc.getElementById('sd-jsonld')!.textContent!);

    expect(data['@type']).toBe('BlogPosting');
    expect(data.headline).toBe('T');
    expect(data.inLanguage).toBe('fr');
    expect(data.image).toEqual(['https://x/y.png']);

    seo.setArticleJsonLd({ ...base, datePublished: '2026-02-01', dateModified: '2026-02-02' });
    expect(doc.querySelectorAll('#sd-jsonld').length).toBe(1);
    data = JSON.parse(doc.getElementById('sd-jsonld')!.textContent!);
    expect(data.datePublished).toBe('2026-02-01');
    expect(data.image).toEqual([DEFAULT_OG_IMAGE]);
  });

  it('clearJsonLd() removes the script when present and is a no-op otherwise', () => {
    seo.setArticleJsonLd({ ...base, datePublished: '2026-01-01', dateModified: '2026-01-02' });
    expect(doc.getElementById('sd-jsonld')).toBeTruthy();

    seo.clearJsonLd();
    expect(doc.getElementById('sd-jsonld')).toBeNull();
    expect(() => seo.clearJsonLd()).not.toThrow();
  });
});
