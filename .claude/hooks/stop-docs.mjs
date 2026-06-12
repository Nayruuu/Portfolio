#!/usr/bin/env node
// Stop hook (runs after each Claude iteration):
//   1. Block the stop if the kit docs are mechanically broken (deterministic check-docs) — fix first.
//   2. Else, if the kit changed this iteration (marker set by mark-kit-dirty), block ONCE to force the
//      claude-auditor LLM audit, then clear the marker.
// Hooks run shell, not agents — so this can guarantee the deterministic check and *auto-trigger* the
// LLM audit (by instructing the model to run it), but it cannot run the agent itself.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { checkKit } from '../scripts/lib/check-docs.mjs';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const marker = join(root, '.claude', '.kit-dirty');

const issues = checkKit(root);
if (issues.length > 0) {
  const reason =
    `check-docs found ${issues.length} mechanical doc issue(s) — fix before finishing:\n` +
    issues.map((issue) => '  - ' + issue).join('\n');
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

if (existsSync(marker)) {
  rmSync(marker, { force: true });
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        'The kit changed this iteration (.claude / CLAUDE.md / README.md / .claude/conventions / docs/PRODUCT.md). ' +
        'Run the documentation audit before finishing: dispatch the claude-auditor agent ' +
        '(Task subagent_type=claude-auditor) over CLAUDE.md + README.md + .claude/conventions/* + the skills, ' +
        'checked against the code, and fix anything it flags. Then you may finish.',
    }),
  );
  process.exit(0);
}

process.exit(0);
