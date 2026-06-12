import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import type { Lang } from '../../../domain';
import {
  AUTHOR,
  DEFAULT_OG_IMAGE,
  OG_LOCALE,
  SITE_NAME,
  SITE_ORIGIN,
  TWIN_LANG,
  absUrl,
  twinPath,
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
    this.setProperty('og:locale:alternate', OG_LOCALE[TWIN_LANG[data.lang]]);

    this.setName('twitter:card', 'summary_large_image');
    this.setName('twitter:title', data.title);
    this.setName('twitter:description', data.description);
    this.setName('twitter:image', image);

    this.setCanonical(url);
    this.setHreflang(data.path, data.lang);
  }

  /** Inject/replace the BlogPosting JSON-LD for an article route. */
  public setArticleJsonLd(data: ArticleJsonLd): void {
    const url = absUrl(data.path);
    const image = data.image ?? DEFAULT_OG_IMAGE;

    this.setJsonLd({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: data.title,
      description: data.description,
      datePublished: data.datePublished,
      dateModified: data.dateModified,
      inLanguage: data.lang,
      image: [image],
      author: { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url },
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_ORIGIN,
        logo: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/favicon.svg` },
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    });
  }

  /** Remove the JSON-LD when leaving an article for a non-article route. */
  public clearJsonLd(): void {
    this.doc.getElementById(SeoService.JSON_LD_ID)?.remove();
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

  private setHreflang(path: string, lang: Lang): void {
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

    add(lang, path);
    add(TWIN_LANG[lang], twinPath(path, lang));
    add('x-default', path.replace(new RegExp(`^/${lang}(?=/|$)`), '/fr'));
  }

  private setJsonLd(payload: object): void {
    let script = this.doc.getElementById(SeoService.JSON_LD_ID) as HTMLScriptElement | null;

    if (!script) {
      script = this.doc.createElement('script');
      script.id = SeoService.JSON_LD_ID;
      script.type = 'application/ld+json';
      this.doc.head.appendChild(script);
    }
    script.textContent = JSON.stringify(payload); // textContent → no HTML parsing / XSS
  }
}
