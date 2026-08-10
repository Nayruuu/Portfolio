import type { ArticleBlock, TocEntry } from '../../domain';
import { runsText } from './runs-text';
import { slugify } from './slugify';

/** Below this many headings a table of contents is noise, not navigation. */
const MIN_HEADINGS = 2;

/**
 * Every `h2`/`h3` block as a `{ id, text, level }` entry, in document order — one entry per
 * heading, no min-heading gate. Ids are `slugify(runsText(...))`, disambiguated so two headings
 * that slug to the same string (e.g. a reused "Conclusion") never collide: a repeat gets `-2`,
 * `-3`, … until free. This is the single source of truth for heading ids, TOC links and the
 * scroll-spy targets — they line up because they all read from here.
 */
export function tocEntries(blocks: readonly ArticleBlock[]): TocEntry[] {
  const entries: TocEntry[] = [];
  const used = new Set<string>();

  for (const block of blocks) {
    if (block.type === 'h2' || block.type === 'h3') {
      const text = runsText(block.runs);
      const base = slugify(text);
      let id = base;
      let suffix = 2;

      while (used.has(id)) {
        id = `${base}-${suffix++}`;
      }
      used.add(id);
      entries.push({ id, text, level: block.type === 'h2' ? 2 : 3 });
    }
  }

  return entries;
}

/** {@link tocEntries} for the sticky rail — empty below `MIN_HEADINGS`, a one-item TOC is noise. */
export function buildToc(blocks: readonly ArticleBlock[]): TocEntry[] {
  const entries = tocEntries(blocks);

  return entries.length < MIN_HEADINGS ? [] : entries;
}
