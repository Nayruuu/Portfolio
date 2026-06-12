import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize,
  normalizeTokens,
  similarity,
  fileSimilarity,
  scoreTrees,
  floorOf,
  layerOf,
} from './reproduction-score.mjs';

test('tokenize removes comments but keeps code', () => {
  const tokens = tokenize('const x = 1; // hi\n/* block */ const y = 2;', 'ts');
  assert.deepEqual(tokens, ['const', 'x', '=', '1', ';', 'const', 'y', '=', '2', ';']);
});

test('tokenize keeps string literals opaque (// and /* */ inside strings are not comments)', () => {
  const tokens = tokenize("const u = 'http://a.com/*x*/';", 'ts');
  assert.ok(tokens.includes("'http://a.com/*x*/'"), `got ${JSON.stringify(tokens)}`);
});

test('REGRESSION #9: a /* */ straddling two string literals must NOT delete the code between them', () => {
  const orig = "const a = '/*'; doRealWork(1); const b = '*/';";
  const reb = "const a = '/*'; somethingElse(2); const b = '*/';";
  const score = fileSimilarity(orig, reb, 'ts');
  assert.ok(score < 1, `divergent code scored ${score} — the straddle bug is back`);
});

test('REGRESSION #6/#20: differing only inside a URL string lowers similarity (not corrupted to equal)', () => {
  const score = fileSimilarity("const u = 'http://a.com';", "const u = 'http://b.com';", 'ts');
  assert.ok(score > 0 && score < 1, `got ${score}`);
});

test('imports are dropped, so import differences do not penalise a correct rebuild', () => {
  const orig = "import { A } from 'a';\nimport { B } from 'b';\nexport const x = f(A, B);";
  const reb = "import { B } from 'b';\nexport const x = f(A, B);";
  assert.equal(fileSimilarity(orig, reb, 'ts'), 1);
});

test('dynamic import() is NOT stripped (lazy routes survive)', () => {
  const tokens = normalizeTokens("const r = { loadComponent: () => import('./x') };", 'ts');
  assert.ok(tokens.includes('import'), `dynamic import was stripped: ${JSON.stringify(tokens)}`);
});

test('similarity of identical / disjoint token streams is 1 / 0', () => {
  assert.equal(similarity(['a', 'b', 'c'], ['a', 'b', 'c']), 1);
  assert.equal(similarity(['a', 'b'], ['x', 'y']), 0);
});

test('fileSimilarity: a local rename costs a little, not everything', () => {
  const score = fileSimilarity(
    'export function f(value) { return value + 1; }',
    'export function f(input) { return input + 1; }',
    'ts',
  );
  assert.ok(score > 0.5 && score < 1, `got ${score}`);
});

test('scoreTrees: missing rebuild file scores 0; reports global + meanPerFile', () => {
  const original = { 'a.ts': 'export const a = 1;\n'.repeat(10), 'b.ts': 'export const b = 2;' };
  const rebuild = { 'a.ts': 'export const a = 1;\n'.repeat(10) };
  const result = scoreTrees(original, rebuild);
  assert.equal(result.files['b.ts'].similarity, 0);
  assert.ok(result.global > 0.85 && result.global < 1);
  assert.ok(typeof result.meanPerFile === 'number' && result.meanPerFile < 1);
});

test('floorOf: same-corpus mismatched pairing yields a floor below 1', () => {
  const tree = {
    'a.ts': 'export const a = 1;',
    'b.ts': 'export const b = 2;',
    'c.ts': 'export const c = 3;',
  };
  const floor = floorOf(tree);
  assert.ok(floor > 0 && floor < 1, `got ${floor}`);
});

test('layerOf maps paths to layers incl. shell and styles', () => {
  assert.equal(layerOf('src/app/domain/article/article.ts'), 'domain');
  assert.equal(layerOf('src/app/core/lib/markdown.ts'), 'core');
  assert.equal(layerOf('src/app/features/home/home.component.ts'), 'features');
  assert.equal(layerOf('src/app/app.routes.ts'), 'shell');
  assert.equal(layerOf('src/styles/_tokens.scss'), 'styles');
});
