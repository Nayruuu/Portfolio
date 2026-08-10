/**
 * Typewriter — returns the substring revealed up to `elapsed`.
 *
 * @param elapsed      seconds since the chapter started
 * @param at           seconds at which typing should begin
 * @param text         the full string
 * @param charsPerSec  typing speed (default 35 cps)
 */
export function typed(elapsed: number, at: number, text: string, charsPerSec = 35): string {
  if (elapsed < at) {
    return '';
  }
  const charCount = Math.floor((elapsed - at) * charsPerSec);

  return text.slice(0, Math.min(text.length, charCount));
}
