#!/usr/bin/env node
// PostToolUse(Edit|Write|MultiEdit) hook: if the edited file is part of the KIT
// (.claude/** | CLAUDE.md | README.md | docs/PRODUCT.md), drop a marker so the Stop
// hook forces a claude-auditor audit this iteration. Reads the tool payload from stdin.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

let raw = '';
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let filePath = '';
  try {
    filePath = JSON.parse(raw)?.tool_input?.file_path || '';
  } catch {
    /* malformed payload — nothing to mark */
  }

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const rel = filePath.startsWith(root) ? filePath.slice(root.length).replace(/^\//, '') : filePath;

  const isKit =
    /^\.claude\//.test(rel) ||
    rel === 'CLAUDE.md' ||
    rel === 'README.md' ||
    rel === 'docs/PRODUCT.md';

  if (isKit && !rel.endsWith('.kit-dirty')) {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', '.kit-dirty'), '');
  }

  process.exit(0);
});
