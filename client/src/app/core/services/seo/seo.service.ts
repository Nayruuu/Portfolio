import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DEFAULT_LANG, LANGS, type Lang } from '../../../domain';
import {
  DEFAULT_OG_IMAGE,
  OG_LOCALE,
  PERSON,
  PERSON_ID,
  SITE_NAME,
  SITE_ORIGIN,
  absUrl,
  pathInLang,
} from '../../lib';

/** Per-route SEO inputs. */
export interface SeoData {
  title: string;
  description: string;
  /** Absolute app path, e.g. `/fr/articles/3`. */
  path: string;
  lang: Lang;
  image?: string;
  type?: 'website' | 'article';
}

/** schema.org BlogPosting inputs (superset of SeoData). */
export interface ArticleJsonLd extends SeoData {
  datePublished: string;
  dateModified: string;
}

/** schema.org SoftwareSourceCode inputs for a project detail page. */
export interface ProjectJsonLd {
  name: string;
  description: string;
  stack: string[];
  repo: string;
  programmingLanguage: string;
  /** SPDX license URL. */
  license: string;
  /** Other canonical identities (NuGet / docs / live site) → `sameAs`. */
  sameAs: string[];
  path: string;
  lang: Lang;
}

/** One BreadcrumbList link (localized label + app path). */
export interface Crumb {
  name: string;
  path: string;
}

/**
 * Sets per-route SEO metadata (title, meta, OpenGraph, Twitter, canonical,
 * hreflang) and the article JSON-LD. All DOM writes are idempotent (add-or-replace)
 * so re-running on every navigation leaves exactly one of each tag — the snapshot
 * prerenderer freezes whatever is in `<head>` once the route is ready.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private static readonly JSON_LD_ID = 'sd-jsonld';

  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly doc = inject(DOCUMENT);

  /** Title + description + OpenGraph + Twitter + canonical + hreflang. */
  public update(data: SeoData): void {
    const url = absUrl(data.path);
    const image = data.image ?? DEFAULT_OG_IMAGE;
    const type = data.type ?? 'website';

    this.title.setTitle(data.title);
    this.setName('description', data.description);

    this.setProperty('og:title', data.title);
    this.setProperty('og:description', data.description);
    this.setProperty('og:type', type);
    this.setProperty('og:url', url);
    this.setProperty('og:image', image);
    this.setProperty('og:site_name', SITE_NAME);
    this.setProperty('og:locale', OG_LOCALE[data.lang]);
    this.setLocaleAlternates(data.lang);

    this.setName('twitter:card', 'summary_large_image');
    this.setName('twitter:title', data.title);
    this.setName('twitter:description', data.description);
    this.setName('twitter:image', image);

    this.setCanonical(url);
    this.setHreflang(data.path);
  }

  /** Inject/replace the BlogPosting (+ BreadcrumbList) JSON-LD for an article route. */
  public setArticleJsonLd(data: ArticleJsonLd, crumbs: readonly Crumb[]): void {
    const url = absUrl(data.path);
    const image = data.image ?? DEFAULT_OG_IMAGE;

    this.setJsonLd([
      {
        '@type': 'BlogPosting',
        headline: data.title,
        description: data.description,
        datePublished: data.datePublished,
        dateModified: data.dateModified,
        inLanguage: data.lang,
        image: [image],
        author: PERSON,
        publisher: {
          '@type': 'Organization',
          name: SITE_NAME,
          url: SITE_ORIGIN,
          logo: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/favicon.svg` },
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, position) => ({
          '@type': 'ListItem',
          position: position + 1,
          name: crumb.name,
          item: absUrl(crumb.path),
        })),
      },
    ]);
  }

  /** Inject/replace the site-level WebSite + canonical Person JSON-LD (home routes). */
  public setSiteJsonLd(lang: Lang): void {
    this.setJsonLd([this.siteNode(lang), PERSON]);
  }

  /** Inject/replace the WebSite + ProfilePage + canonical Person JSON-LD (about = named-entity route). */
  public setProfileJsonLd(lang: Lang, path: string): void {
    const url = absUrl(path);

    this.setJsonLd([
      this.siteNode(lang),
      {
        '@type': 'ProfilePage',
        '@id': url,
        url,
        inLanguage: lang,
        mainEntity: { '@id': PERSON_ID },
      },
      PERSON,
    ]);
  }

  /** Inject/replace the SoftwareSourceCode (+ BreadcrumbList) JSON-LD for a project detail route. */
  public setProjectJsonLd(data: ProjectJsonLd, crumbs: readonly Crumb[]): void {
    const url = absUrl(data.path);

    this.setJsonLd([
      {
        '@type': 'SoftwareSourceCode',
        name: data.name,
        description: data.description,
        url,
        codeRepository: data.repo,
        programmingLanguage: data.programmingLanguage,
        keywords: data.stack.join(', '),
        license: data.license,
        sameAs: data.sameAs,
        author: PERSON,
        inLanguage: data.lang,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, position) => ({
          '@type': 'ListItem',
          position: position + 1,
          name: crumb.name,
          item: absUrl(crumb.path),
        })),
      },
    ]);
  }

  /** Inject/replace the WebSite + CollectionPage (ItemList) + Person JSON-LD for the projects list. */
  public setProjectsJsonLd(lang: Lang, path: string, items: readonly Crumb[]): void {
    const url = absUrl(path);

    this.setJsonLd([
      this.siteNode(lang),
      {
        '@type': 'CollectionPage',
        '@id': url,
        url,
        inLanguage: lang,
        about: { '@id': PERSON_ID },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: items.map((item, position) => ({
            '@type': 'ListItem',
            position: position + 1,
            name: item.name,
            url: absUrl(item.path),
          })),
        },
      },
      PERSON,
    ]);
  }

  /** Remove the JSON-LD when leaving an article for a non-article route. */
  public clearJsonLd(): void {
    this.doc.getElementById(SeoService.JSON_LD_ID)?.remove();
  }

  /**
   * The `WebSite` graph node — named after the PERSON (the entity we want a name query to resolve to),
   * with the domain kept as `alternateName`. `og:site_name` stays the domain, so nothing contradicts.
   */
  private siteNode(lang: Lang): object {
    return {
      '@type': 'WebSite',
      name: PERSON.name,
      alternateName: SITE_NAME,
      url: SITE_ORIGIN,
      inLanguage: lang,
    };
  }

  private setName(name: string, content: string): void {
    this.meta.updateTag({ name, content });
  }

  private setProperty(property: string, content: string): void {
    this.meta.updateTag({ property, content }, `property='${property}'`);
  }

  private setCanonical(href: string): void {
    let link = this.doc.head.querySelector<HTMLLinkElement>("link[rel='canonical']");

    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', href);
  }

  private setHreflang(path: string): void {
    this.doc.head
      .querySelectorAll("link[rel='alternate'][data-seo='hreflang']")
      .forEach((element) => element.remove());

    const add = (hreflang: string, href: string): void => {
      const link = this.doc.createElement('link');

      link.setAttribute('rel', 'alternate');
      link.setAttribute('hreflang', hreflang);
      link.setAttribute('href', absUrl(href));
      link.setAttribute('data-seo', 'hreflang');
      this.doc.head.appendChild(link);
    };

    for (const alternate of LANGS) {
      add(alternate, pathInLang(path, alternate));
    }
    add('x-default', pathInLang(path, DEFAULT_LANG));
  }

  /** og:locale:alternate — one per OTHER language (cleared first so re-navigation stays idempotent). */
  private setLocaleAlternates(lang: Lang): void {
    this.doc.head
      .querySelectorAll("meta[property='og:locale:alternate']")
      .forEach((element) => element.remove());
    for (const alternate of LANGS) {
      if (alternate === lang) {
        continue;
      }
      const meta = this.doc.createElement('meta');

      meta.setAttribute('property', 'og:locale:alternate');
      meta.setAttribute('content', OG_LOCALE[alternate]);
      this.doc.head.appendChild(meta);
    }
  }

  private setJsonLd(entities: readonly object[]): void {
    let script = this.doc.getElementById(SeoService.JSON_LD_ID) as HTMLScriptElement | null;

    if (!script) {
      script = this.doc.createElement('script');
      script.id = SeoService.JSON_LD_ID;
      script.type = 'application/ld+json';
      this.doc.head.appendChild(script);
    }
    // textContent → no HTML parsing / XSS
    script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': entities });
  }
}
