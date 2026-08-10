/** Pad seconds into mm:ss. */
export function formatTime(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.floor(totalSec % 60);

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
