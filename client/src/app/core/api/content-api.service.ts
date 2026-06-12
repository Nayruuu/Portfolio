import { Injectable, inject } from '@angular/core';
import { Content, Lang } from '../../domain';
import { FR } from '../content/content.fr';
import { EN } from '../content/content.en';
import { ES } from '../content/content.es';
import { DE } from '../content/content.de';
import { API_BASE_URL } from './api.token';

/** Simulated network latency for the mocked fetch (ms). */
export const FETCH_DELAY_MS = 300;

/**
 * Content gateway — the single seam between the app and "where content comes from".
 *
 * Today it's a **mock** over the bundled content; tomorrow it's the only file that changes to call
 * the real .NET API at `API_BASE_URL`. It exposes the shape of a cached HTTP client:
 *  - `peek()` — **synchronous** cached value, used to seed the store for instant first paint and so
 *    the native SSG prerender still has content at build time (see CLAUDE.md "SEO / SSG").
 *  - `getContent()` — **asynchronous** fetch (simulated latency), the real network call would-be.
 */
@Injectable({ providedIn: 'root' })
export class ContentApiService {
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * Bundled content per language — the map a real client would replace with a fetch. Typed
   * `Record<Lang, Content>`, so adding a `Lang` fails to compile until its bundle is wired here.
   */
  private readonly bundled: Record<Lang, Content> = { fr: FR, en: EN, es: ES, de: DE };

  /** The endpoint a real client would GET for a locale's content. */
  public contentUrl(lang: Lang): string {
    return `${this.baseUrl}/content/${lang}`;
  }

  public peek(lang: Lang): Content {
    return this.bundled[lang];
  }

  public getContent(lang: Lang): Promise<Content> {
    // Mock: a real client would `fetch(this.contentUrl(lang))`; we serve bundled content after a delay.
    return new Promise((resolve) => setTimeout(() => resolve(this.peek(lang)), FETCH_DELAY_MS));
  }
}
