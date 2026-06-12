#!/usr/bin/env node
// CLI: verify the kit docs (refs, links, prose-only PRODUCT.md, config names). Exits 1 on any issue.
// Usage: node .claude/scripts/check-docs.mjs [repoRoot=.]   (also wired as `make check-docs` + the Stop hook)
import { checkKit } from './lib/check-docs.mjs';

const root = process.argv[2] || '.';
const issues = checkKit(root);

if (issues.length > 0) {
  console.error(`✘ check-docs: ${issues.length} doc issue(s):`);
  for (const issue of issues) {
    console.error('  - ' + issue);
  }
  process.exit(1);
}

console.log('✓ check-docs: kit docs valid (refs, links, prose-only PRODUCT.md, config names)');
