import type { InlineRun } from '../../domain';

/** The plain text of an `InlineRun[]` — every span's text concatenated, formatting dropped. */
export function runsText(runs: readonly InlineRun[]): string {
  return runs.map((run) => run.text).join('');
}
