import { describe, expect, it } from 'vitest';
import type { InlineRun } from '../../domain';
import { runsText } from './runs-text';

describe('runsText', () => {
  it('returns an empty string for no runs', () => {
    expect(runsText([])).toBe('');
  });

  it('returns the text of a single run', () => {
    expect(runsText([{ kind: 'text', text: 'Hello' }])).toBe('Hello');
  });

  it('concatenates every run regardless of kind, dropping formatting', () => {
    const runs: InlineRun[] = [
      { kind: 'text', text: 'The ' },
      { kind: 'bold', text: 'zoneless' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'signal' },
      { kind: 'link', text: ' guide', href: 'https://example.com' },
    ];

    expect(runsText(runs)).toBe('The zoneless signal guide');
  });
});
