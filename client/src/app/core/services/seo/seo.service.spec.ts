import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { SeoService } from './seo.service';
import { DEFAULT_OG_IMAGE, PERSON, PERSON_ID, SITE_NAME, SOCIAL_URLS } from '../../lib';

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
    // og:locale:alternate — one per OTHER language (en).
    expect(doc.querySelectorAll("meta[property='og:locale:alternate']").length).toBe(1);
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
    // Author is the ONE canonical Person (shared @id) — the entity-unification lever.
    expect(posting.author['@id']).toBe(PERSON_ID);

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
    // The site is NAMED after the person (entity target); the domain stays as alternateName.
    expect(graph[0].name).toBe(PERSON.name);
    expect(graph[0].alternateName).toBe(SITE_NAME);
    expect(graph[1]['@type']).toBe('Person');
    expect(graph[1]['@id']).toBe(PERSON_ID);
    expect(graph[1].sameAs).toEqual([...SOCIAL_URLS]);
  });

  it('setProfileJsonLd() injects WebSite + ProfilePage + the canonical Person (shared @id)', () => {
    seo.setProfileJsonLd('fr', '/fr/about');
    const graph = JSON.parse(doc.getElementById('sd-jsonld')!.textContent!)['@graph'];

    expect(graph[0]['@type']).toBe('WebSite');
    expect(graph[1]['@type']).toBe('ProfilePage');
    expect(graph[1]['@id']).toBe('https://super-dev.app/fr/about');
    expect(graph[1].mainEntity['@id']).toBe(PERSON_ID);
    expect(graph[2]['@type']).toBe('Person');
    expect(graph[2]['@id']).toBe(PERSON_ID);
    expect(graph[2].jobTitle).toBeTruthy();
  });

  it('setProjectJsonLd() injects a SoftwareSourceCode (author = canonical Person) + BreadcrumbList', () => {
    seo.setProjectJsonLd(
      {
        name: 'NgSharp',
        description: 'Template engine',
        stack: ['C#', '.NET 9'],
        repo: 'https://github.com/Nayruuu/NgSharp',
        programmingLanguage: 'C#',
        license: 'https://opensource.org/licenses/MIT',
        sameAs: ['https://www.nuget.org/packages/NgSharp'],
        path: '/fr/projects/ngsharp',
        lang: 'fr',
      },
      [
        { name: 'Projets', path: '/fr/projects' },
        { name: 'NgSharp', path: '/fr/projects/ngsharp' },
      ],
    );
    const graph = JSON.parse(doc.getElementById('sd-jsonld')!.textContent!)['@graph'];
    const code = graph[0];

    expect(code['@type']).toBe('SoftwareSourceCode');
    expect(code.name).toBe('NgSharp');
    expect(code.url).toBe('https://super-dev.app/fr/projects/ngsharp');
    expect(code.codeRepository).toBe('https://github.com/Nayruuu/NgSharp');
    expect(code.programmingLanguage).toBe('C#');
    expect(code.license).toBe('https://opensource.org/licenses/MIT');
    expect(code.keywords).toBe('C#, .NET 9');
    expect(code.sameAs).toEqual(['https://www.nuget.org/packages/NgSharp']);
    // Author folds to the ONE canonical Person @id (entity unification).
    expect(code.author['@id']).toBe(PERSON_ID);

    const breadcrumb = graph[1];

    expect(breadcrumb['@type']).toBe('BreadcrumbList');
    expect(breadcrumb.itemListElement[1].item).toBe('https://super-dev.app/fr/projects/ngsharp');
  });

  it('setProjectsJsonLd() injects WebSite + CollectionPage (ItemList) + the canonical Person', () => {
    seo.setProjectsJsonLd('fr', '/fr/projects', [
      { name: 'NgSharp', path: '/fr/projects/ngsharp' },
      { name: 'Universe Map', path: '/fr/projects/universe-map' },
    ]);
    const graph = JSON.parse(doc.getElementById('sd-jsonld')!.textContent!)['@graph'];

    expect(graph[0]['@type']).toBe('WebSite');
    expect(graph[1]['@type']).toBe('CollectionPage');
    expect(graph[1]['@id']).toBe('https://super-dev.app/fr/projects');
    expect(graph[1].about['@id']).toBe(PERSON_ID);
    expect(graph[1].mainEntity['@type']).toBe('ItemList');
    expect(graph[1].mainEntity.itemListElement[1].url).toBe(
      'https://super-dev.app/fr/projects/universe-map',
    );
    expect(graph[2]['@type']).toBe('Person');
    expect(graph[2]['@id']).toBe(PERSON_ID);
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
