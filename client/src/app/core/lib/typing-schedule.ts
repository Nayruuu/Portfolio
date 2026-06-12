/**
 * Sequential typing schedule — chained start times so only ONE element types at a time
 * (the typewriter has a single print head). `starts[0] = startAt`; each next text starts
 * when the previous one finishes (`length / cps`) plus a small breath (`gap`).
 *
 * @param lengths text lengths, in visual order
 * @param startAt seconds at which the first text starts typing
 * @param cps     typing speed shared by every text in the chain
 * @param gap     pause between two texts (default 0.15s)
 */
export function typingSchedule(
  lengths: number[],
  startAt: number,
  cps: number,
  gap = 0.15,
): number[] {
  const starts: number[] = [];
  let current = startAt;

  for (const length of lengths) {
    starts.push(current);
    current += length / cps + gap;
  }

  return starts;
}
