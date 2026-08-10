// Deterministic verifier for the kit docs. Pure functions + checkKit(repoRoot) → issues[].
// Catches the *mechanical* class of doc defects (the ones a fast hook can guarantee): broken
// cross-doc §N refs, broken relative links, language-tagged code fences leaking into the prose-only
// PRODUCT.md, and stale config filenames. Semantic issues (single-source duplication, code-fidelity)
// are the LLM audit's job, not this.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

/** The kit docs this verifier validates (paths relative to repo root). */
export const KIT_DOCS = [
  'CLAUDE.md',
  'REPRODUCIBILITY.md',
  'docs/PRODUCT.md',
  '.claude/conventions/architecture.md',
  '.claude/conventions/code.md',
  '.claude/conventions/design.md',
  '.claude/conventions/testing.md',
  '.claude/skills/angular-rules/SKILL.md',
  '.claude/skills/design/SKILL.md',
];

/** `## N.` section numbers present in a markdown doc. */
export function sectionNumbers(markdown) {
  const numbers = new Set();
  for (const match of markdown.matchAll(/^##\s+(\d+)\./gm)) {
    numbers.add(Number(match[1]));
  }

  return numbers;
}

/** A `X.md §N` cross-reference whose target convention doc lacks section N. */
export function checkSectionRefs(docsByPath) {
  const issues = [];
  for (const [file, content] of Object.entries(docsByPath)) {
    for (const match of content.matchAll(/(architecture|code|design|testing)\.md`?\s*§\s*(\d+)/g)) {
      const targetPath = `.claude/conventions/${match[1]}.md`;
      const section = Number(match[2]);
      const target = docsByPath[targetPath];
      if (target === undefined) {
        continue;
      }
      if (!sectionNumbers(target).has(section)) {
        issues.push(`${file}: broken ref → ${match[1]}.md §${section} (no such section)`);
      }
    }
  }

  return issues;
}

/** Relative markdown links that don't resolve to a real file (skips http/anchors/mailto). */
export function checkRelativeLinks(repoRoot, file, content) {
  const issues = [];
  const dir = dirname(join(repoRoot, file));
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const raw = match[1].trim();
    if (/^(https?:|#|mailto:|tel:)/.test(raw)) {
      continue;
    }
    const target = raw.split('#')[0];
    if (!target) {
      continue;
    }
    if (!existsSync(resolve(dir, target))) {
      issues.push(`${file}: broken link → ${raw}`);
    }
  }

  return issues;
}

/** Language-tagged code fences (```ts, ```html, …) — forbidden in the prose-only PRODUCT.md. */
export function checkProseFences(file, content) {
  const issues = [];
  for (const match of content.matchAll(/^```([A-Za-z][\w-]*)/gm)) {
    issues.push(`${file}: language-tagged code fence \`\`\`${match[1]} (this doc is prose-only)`);
  }

  return issues;
}

const STALE_NAMES = [[/`\.prettierrc`/g, '`.prettierrc` → use `.prettierrc.json`']];

/** Known stale config filenames referenced in a doc. */
export function checkStaleConfigNames(file, content) {
  const issues = [];
  for (const [pattern, message] of STALE_NAMES) {
    if (pattern.test(content)) {
      issues.push(`${file}: stale config name (${message})`);
    }
  }

  return issues;
}

/** Run every check over the kit docs that exist; return a flat list of issue strings. */
export function checkKit(repoRoot) {
  const docs = {};
  for (const file of KIT_DOCS) {
    const abs = join(repoRoot, file);
    if (existsSync(abs)) {
      docs[file] = readFileSync(abs, 'utf8');
    }
  }

  const issues = [...checkSectionRefs(docs)];
  for (const [file, content] of Object.entries(docs)) {
    issues.push(...checkRelativeLinks(repoRoot, file, content));
    issues.push(...checkStaleConfigNames(file, content));
    if (file === 'docs/PRODUCT.md') {
      issues.push(...checkProseFences(file, content));
    }
  }

  return issues;
}
