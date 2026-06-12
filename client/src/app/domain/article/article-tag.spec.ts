import { describe, expect, it } from 'vitest';
import { ARTICLE_TAGS } from './article-tag';

describe('ARTICLE_TAGS', () => {
  it('is the closed 6-tag vocabulary aligned to pill indices 3..8', () => {
    expect(ARTICLE_TAGS).toEqual(['.NET', 'ANGULAR', 'AZURE', 'FLUTTER', 'DEVOPS', 'TUTO']);
  });
});
