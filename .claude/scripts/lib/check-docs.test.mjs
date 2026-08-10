import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionNumbers,
  checkSectionRefs,
  checkRelativeLinks,
  checkProseFences,
  checkStaleConfigNames,
} from './check-docs.mjs';

test('sectionNumbers extracts `## N.` headers', () => {
  const nums = sectionNumbers('# Title\n## 1. A\n## 2. B\n### 2.1 sub\n## 7. G\n');
  assert.deepEqual([...nums].sort((a, b) => a - b), [1, 2, 7]);
});

test('checkSectionRefs flags a §N ref to a non-existent section', () => {
  const docs = {
    '.claude/conventions/code.md': 'see architecture.md §17 and architecture.md §5',
    '.claude/conventions/architecture.md': '## 5. The bridge\n## 7. Routing\n',
  };
  const issues = checkSectionRefs(docs);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /architecture\.md §17/);
});

test('checkSectionRefs passes when the ref resolves', () => {
  const docs = {
    '.claude/conventions/code.md': 'see architecture.md §7',
    '.claude/conventions/architecture.md': '## 7. Routing\n',
  };
  assert.deepEqual(checkSectionRefs(docs), []);
});

test('checkRelativeLinks flags a missing file, ignores http/anchors', () => {
  const content = 'ok [a](./check-docs.mjs) bad [b](./nope.md) ext [c](https://x.com) anchor [d](#sec)';
  // repoRoot = this test's dir; file 'x.md' lives there, so ./check-docs.mjs resolves to the real one
  const issues = checkRelativeLinks(import.meta.dirname, 'x.md', content);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /nope\.md/);
});

test('checkProseFences flags language-tagged fences but not bare ```', () => {
  assert.equal(checkProseFences('docs/PRODUCT.md', 'prose\n```ts\ncode\n```\n').length, 1);
  assert.deepEqual(checkProseFences('docs/PRODUCT.md', 'art\n```\n┌──┐\n```\n'), []);
});

test('checkStaleConfigNames flags `.prettierrc` but not `.prettierrc.json`', () => {
  assert.equal(checkStaleConfigNames('.claude/conventions/design.md', 'the `.prettierrc` file').length, 1);
  assert.deepEqual(checkStaleConfigNames('.claude/conventions/design.md', 'the `.prettierrc.json` file'), []);
});
