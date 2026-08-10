// The blind-rebuild seed contract: what enters repro/ (kit + reused data + config), and what must
// never enter it (the reproduced app source, or anything that leaks the original file tree).

/** Paths (relative to repo root) copied verbatim into the blind repro/ workspace. */
export const COPY = [
  'CLAUDE.md',
  'docs/PRODUCT.md',
  '.claude/conventions/**', // the canonical rulebook — kit input
  'docs/mockups/**', // the rendered-screen visual reference (reconstruct SCSS to match these)
  // .claude is allow-listed (NOT '.claude/**') so settings.local.json — which embeds the original
  // source file tree — never leaks into the blind workspace.
  '.claude/skills/**',
  '.claude/agents/**',
  '.claude/hooks/**',
  '.claude/commands/**',
  '.claude/settings.json',
  'client/package.json',
  'client/angular.json',
  'client/tsconfig.json',
  'client/tsconfig.app.json',
  'client/tsconfig.spec.json',
  'client/eslint.config.mjs',
  'client/eslint-rules/**',
  'client/.prettierrc.json',
  'client/.prettierignore',
  'client/.stylelintrc.json',
  'client/scripts/**',
  'Makefile',
  'client/src/content/**', // article .md bodies — REUSED data
  // The two content JSON files are REUSED data, but they live inside the forbidden src/app tree;
  // seed them by exact path (see ALLOW), never the surrounding core/content directory.
  'client/src/app/core/content/content.fr.json',
  'client/src/app/core/content/content.en.json',
  // the icon vector paths — an un-inventable design asset, PROVIDED like the token table
  'client/src/app/shared/icon/icon.component.html',
  'client/public/**', // favicon, og, staticwebapp config — REUSED
  'client/src/index.html',
  'client/src/main.ts',
  'client/src/main.server.ts',
  'client/src/types/**',
  'client/src/environments/**',
];

/** Exact reused-data / provided-asset files allowed through despite living under a FORBIDDEN tree. */
export const ALLOW = new Set([
  'client/src/app/core/content/content.fr.json',
  'client/src/app/core/content/content.en.json',
  'client/src/app/shared/icon/icon.component.html',
]);

/**
 * Provided assets that live in the SCORED tree (.ts/.html/.scss) but are reused verbatim, so they
 * must be EXCLUDED from CRS — they are un-inventable design assets (icon vector paths), provided like
 * the token table, not reproduced. Paths are relative to a tree root (e.g. `client/` or `repro/`).
 */
export const SCORED_EXCLUDE = ['src/app/shared/icon/icon.component.html'];

/** Matches → the reproduced source, or a tree/layout leak — must NOT enter the blind workspace. */
export const FORBIDDEN = [
  /^client\/src\/app\//, // every reproduced component/service/type
  /^client\/src\/styles\b/, // both src/styles.scss (entry) and src/styles/ (partials)
  /(^|\/)settings\.local\.json$/, // leaks the original source file tree
];

export function isForbidden(path) {
  if (ALLOW.has(path)) {
    return false;
  }

  return FORBIDDEN.some((pattern) => pattern.test(path));
}
