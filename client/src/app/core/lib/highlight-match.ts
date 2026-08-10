import { paletteMatch } from './palette-match';

/**
 * Splits `label` into matched / unmatched runs for template highlighting, using the same
 * first-match subsequence as `paletteMatch` (greedy: each query char consumes the earliest label
 * char that has not been consumed yet). A non-matching or empty query yields the whole label as one
 * unmatched run. Deterministic and pure.
 */
export function highlightMatch(label: string, query: string): { text: string; hit: boolean }[] {
  if (label === '') {
    return [];
  }
  if (!paletteMatch(label, query)) {
    return [{ text: label, hit: false }];
  }
  const needle = query.toLowerCase();
  const hits = new Set<number>();
  let cursor = 0;

  for (const char of needle) {
    for (let index = cursor; index < label.length; index++) {
      if (label[index].toLowerCase() === char) {
        hits.add(index);
        cursor = index + 1;
        break;
      }
    }
  }

  const segments: { text: string; hit: boolean }[] = [];

  for (let index = 0; index < label.length; index++) {
    const hit = hits.has(index);
    const last = segments.at(-1);

    if (last !== undefined && last.hit === hit) {
      last.text += label[index];
    } else {
      segments.push({ text: label[index], hit });
    }
  }

  return segments;
}
