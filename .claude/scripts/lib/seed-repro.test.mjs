import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY, FORBIDDEN, ALLOW, isForbidden } from './seed-manifest.mjs';

test('manifest copies kit + reused data + build config', () => {
  assert.ok(COPY.some((glob) => glob.includes('content/**'))); // article .md bodies
  assert.ok(COPY.some((glob) => glob.includes('content.fr.json'))); // reused content JSON (exact)
  assert.ok(COPY.some((glob) => glob.includes('public'))); // assets
  assert.ok(COPY.some((glob) => glob.includes('angular.json'))); // build config
  assert.ok(COPY.some((glob) => glob.includes('CLAUDE.md')));
  assert.ok(COPY.some((glob) => glob.includes('PRODUCT.md')));
  assert.ok(COPY.some((glob) => glob.includes('conventions')));
});

test('.claude is allow-listed, NOT a wildcard (settings.local.json never seeded)', () => {
  assert.ok(!COPY.includes('.claude/**'), 'a bare .claude/** glob would leak settings.local.json');
  assert.ok(COPY.includes('.claude/skills/**'));
  assert.ok(COPY.includes('.claude/settings.json'));
  assert.ok(!COPY.some((glob) => glob.includes('settings.local')));
});

test('blindness: reproduced source + tree-leaks are forbidden', () => {
  assert.ok(isForbidden('client/src/app/features/home/home.component.ts'));
  assert.ok(isForbidden('client/src/styles/_tokens.scss'));
  assert.ok(isForbidden('client/src/styles.scss')); // the global entry partial
  assert.ok(isForbidden('.claude/settings.local.json')); // the tree leak
  assert.ok(Array.isArray(FORBIDDEN) && FORBIDDEN.length >= 3);
});

test('reused content JSON is allowed through despite living under src/app', () => {
  assert.ok(!isForbidden('client/src/app/core/content/content.fr.json'));
  assert.ok(!isForbidden('client/src/app/core/content/content.en.json'));
  assert.ok(ALLOW.has('client/src/app/core/content/content.fr.json'));
  // but the surrounding directory's code is still forbidden:
  assert.ok(isForbidden('client/src/app/core/content/content.fr.ts'));
});
