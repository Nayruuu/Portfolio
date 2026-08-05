import { describe, expect, it } from 'vitest';
import { articleDescription } from './article-description';
import type { Article } from '../../domain';

const article = (description: string): Article =>
  ({ description, tag: '.NET', title: 'T', readTime: '9 min' }) as Article;

describe('articleDescription', () => {
  it('returns the entry description unchanged when it fits', () => {
    expect(articleDescription(article('Une description courte.'))).toBe('Une description courte.');
  });

  it('caps a long description at a word boundary with an ellipsis', () => {
    const long = 'mot '.repeat(50).trim();
    const capped = articleDescription(article(long));

    expect(capped.length).toBeLessThanOrEqual(160);
    expect(capped.endsWith('…')).toBe(true);
    expect(capped).not.toContain('mo…');
  });

  it('honors a custom max length', () => {
    expect(articleDescription(article('one two three four'), 10)).toBe('one two…');
  });
});
