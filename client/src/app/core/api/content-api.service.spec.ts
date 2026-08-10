import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ContentApiService } from './content-api.service';
import { FR } from '../content/content.fr';
import { EN } from '../content/content.en';

describe('ContentApiService', () => {
  it('peek returns the bundled content synchronously', () => {
    const api = TestBed.inject(ContentApiService);

    expect(api.peek('fr')).toBe(FR);
    expect(api.peek('en')).toBe(EN);
  });

  it('getContent resolves the content asynchronously', async () => {
    const api = TestBed.inject(ContentApiService);

    await expect(api.getContent('fr')).resolves.toBe(FR);
    await expect(api.getContent('en')).resolves.toBe(EN);
  });

  it('contentUrl builds the endpoint from the injected API base URL', () => {
    const api = TestBed.inject(ContentApiService);

    // Default dev base URL ("/api") from the environment-backed API_BASE_URL token.
    expect(api.contentUrl('fr')).toBe('/api/content/fr');
    expect(api.contentUrl('en')).toBe('/api/content/en');
  });
});
