/**
 * Reveal helper — returns inline style for a progressive fade-in based on chapter-elapsed time.
 * Fade-only (no vertical motion): each element now types in character-by-character, so an added
 * rise-from-below would double up on that entrance — the opacity fade just keeps structural
 * containers (cards/rows/pills) from popping in hard before their text arrives.
 *
 * @param elapsed  seconds since the active chapter started
 * @param at       seconds at which this element should start appearing
 * @param duration fade duration (default 0.5s)
 */
export function reveal(elapsed: number, at: number, duration = 0.5) {
  const fraction = Math.max(0, Math.min(1, (elapsed - at) / duration));

  return {
    opacity: fraction,
    transition: 'opacity .35s ease',
    'will-change': 'opacity',
  };
}
