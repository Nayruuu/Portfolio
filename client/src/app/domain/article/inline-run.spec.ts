import { describe, expect, it } from 'vitest';
import type { InlineRun } from './inline-run';

describe('InlineRun', () => {
  it('discriminates the four kinds; href is optional and link-only', () => {
    const text: InlineRun = { kind: 'text', text: 'plain' };
    const link: InlineRun = { kind: 'link', text: 'docs', href: 'https://x.dev' };

    expect(text.kind).toBe('text');
    expect(text.href).toBeUndefined();
    expect(link.kind).toBe('link');
    expect(link.href).toBe('https://x.dev');
  });
});
