import { describe, expect, it } from 'vitest';
import type { ArticleBlock } from '../../domain';
import { buildToc } from './build-toc';

const h2 = (text: string): ArticleBlock => ({ type: 'h2', runs: [{ kind: 'text', text }] });
const h3 = (text: string): ArticleBlock => ({ type: 'h3', runs: [{ kind: 'text', text }] });

describe('buildToc', () => {
  it('returns an empty list when there are no headings', () => {
    const blocks: ArticleBlock[] = [{ type: 'p', runs: [{ kind: 'text', text: 'Body only' }] }];

    expect(buildToc(blocks)).toEqual([]);
  });

  it('returns an empty list for a lone heading (a one-item TOC is noise)', () => {
    expect(buildToc([h2('Only heading')])).toEqual([]);
  });

  it('maps h2/h3 blocks to id/text/level entries in document order', () => {
    const blocks: ArticleBlock[] = [
      h2('Le contexte'),
      { type: 'p', runs: [{ kind: 'text', text: 'intro' }] },
      h3('Détails'),
      { type: 'code', lang: 'typescript', text: 'const x = 1;' },
      h2('Conclusion'),
    ];

    expect(buildToc(blocks)).toEqual([
      { id: 'le-contexte', text: 'Le contexte', level: 2 },
      { id: 'details', text: 'Détails', level: 3 },
      { id: 'conclusion', text: 'Conclusion', level: 2 },
    ]);
  });

  it('flattens inline formatting into the entry text and its slug id', () => {
    const heading: ArticleBlock = {
      type: 'h2',
      runs: [
        { kind: 'text', text: 'Le ' },
        { kind: 'code', text: 'signal()' },
        { kind: 'text', text: ' pattern' },
      ],
    };

    expect(buildToc([heading, h2('Suite')])).toEqual([
      { id: 'le-signal-pattern', text: 'Le signal() pattern', level: 2 },
      { id: 'suite', text: 'Suite', level: 2 },
    ]);
  });

  it('disambiguates repeated-text headings into unique ids in document order', () => {
    const entries = buildToc([h2('Conclusion'), h3('Conclusion'), h2('Conclusion')]);
    const ids = entries.map((entry) => entry.id);

    expect(ids).toEqual(['conclusion', 'conclusion-2', 'conclusion-3']);
    expect(new Set(ids).size).toBe(ids.length); // every id unique
  });
});
