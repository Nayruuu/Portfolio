/**
 * Cuts `text` at the last word boundary within `max` chars — a mid-word cut
 * reads as a typo in a SERP title.
 */
export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');

  return (lastSpace > 0 ? cut.slice(0, lastSpace) : text.slice(0, max)).trimEnd();
}
