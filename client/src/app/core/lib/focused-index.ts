/**
 * Index of the currently-focused item for the mobile "montage" scenes — the last item whose start
 * offset has been reached (`starts[i] <= elapsed`), or `0` before the first one starts (and for an
 * empty list). Pure on purpose: the mobile one-item-at-a-time playback stays a function of the
 * playhead, so scrubbing is deterministic — exactly like `typed()` / `reveal()`.
 *
 * @param elapsed seconds since the active chapter started
 * @param starts  per-item start offsets, in visual order
 */
export function focusedIndex(elapsed: number, starts: readonly number[]): number {
  let index = 0;

  starts.forEach((start, itemIndex) => {
    if (elapsed >= start) {
      index = itemIndex;
    }
  });

  return index;
}
