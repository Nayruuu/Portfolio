/**
 * Case-insensitive subsequence match: every character of `query` appears in `haystack`, in order
 * (not necessarily contiguous) — the matching rule a ⌘K palette uses. An empty query matches all.
 */
export function paletteMatch(haystack: string, query: string): boolean {
  const needle = query.toLowerCase();

  if (needle === '') {
    return true;
  }
  const hay = haystack.toLowerCase();
  let cursor = 0;

  for (const char of needle) {
    const found = hay.indexOf(char, cursor);

    if (found === -1) {
      return false;
    }
    cursor = found + 1;
  }

  return true;
}
