#!/usr/bin/env node
/**
 * AI translation pipeline — generates `content.<lang>.json` and each article `<slug>.<lang>.md`
 * for every target language by delegating to the local `claude -p` CLI (reproducible, no API key;
 * the translation cost lands in subprocesses, not the build). The typed bridge + `check-prerender`
 * validate completeness afterwards.
 *
 * Robustness:
 *  - `content.json` is translated **leaf by leaf in small batches** — structure is never touched
 *    (we only swap string values), each call is short (no timeout), and a key denylist keeps slugs /
 *    ids / colors / URLs verbatim.
 *  - Each `claude -p` call is **retried** on timeout/parse failure.
 *  - **Resumable**: an output that already exists is skipped (pass `--force` to regenerate).
 *
 * Usage:
 *   node scripts/gen-i18n.mjs es de            # content + all articles, for es & de
 *   node scripts/gen-i18n.mjs es --content-only
 *   node scripts/gen-i18n.mjs es --slug=angular-zoneless-signals --force
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = resolve(APP_ROOT, 'src/app/core/content');
const ARTICLES_DIR = resolve(APP_ROOT, 'src/content/articles');
const SOURCE = 'fr';
const BATCH = 40; // strings per content call
const RETRIES = 2;

const LANG_NAMES = {
  en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', ja: 'Japanese', zh: 'Simplified Chinese', ko: 'Korean',
};

/** Keys whose string values are structural / code / identifiers — never translated. */
const SKIP_KEYS = new Set([
  'slug', 'id', 'kind', 'color', 'accentColor', 'symbol', 'brandTld',
  'timestamp', 'url', 'href', 'value', 'tag', 'featuredTags',
]);

const args = process.argv.slice(2);
const targets = args.filter((a) => !a.startsWith('--'));
const contentOnly = args.includes('--content-only');
const force = args.includes('--force');
const slugArg = args.find((a) => a.startsWith('--slug='))?.split('=')[1];

if (!targets.length) {
  console.error('Usage: node scripts/gen-i18n.mjs <lang…> [--content-only] [--slug=<slug>] [--force]');
  process.exit(1);
}

/** One-shot `claude -p` with tools disabled (no agentic hang) + a fast model, with retries. */
function claude(prompt) {
  for (let attempt = 0; ; attempt++) {
    try {
      return execFileSync(
        'claude',
        ['-p', '--tools', '', '--output-format', 'text', '--model', 'sonnet'],
        { input: prompt, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000 },
      );
    } catch (error) {
      if (attempt >= RETRIES) {
        throw error;
      }
      console.log(`    retry ${attempt + 1}/${RETRIES} (${error.code ?? 'error'})`);
    }
  }
}

/** Extract a JSON array from a (possibly chatty / fenced) reply. */
function extractArray(reply) {
  const fence = reply.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const body = fence ? fence[1] : reply.slice(reply.indexOf('['), reply.lastIndexOf(']') + 1);

  return JSON.parse(body);
}

/**
 * Extract the Markdown body. The model is told to emit the body ONLY, so we keep it verbatim — merely
 * unwrapping an outer ```` ```markdown ```` fence if it wrapped the whole document. We must NOT slice from
 * the first heading: these articles open with an intro paragraph *before* any `##`, and slicing silently
 * dropped it (the bug that left every non-FR body missing its opening lines).
 */
function extractMarkdown(reply) {
  const trimmed = reply.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);

  return (fenced ? fenced[1] : trimmed).trim();
}

/** Collect translatable string leaves as `{ ref, key }` setters, skipping the denylist. */
function collectLeaves(node, sink) {
  if (Array.isArray(node)) {
    node.forEach((_, i) => {
      if (typeof node[i] === 'string') {
        sink.push({ set: (v) => (node[i] = v), get: () => node[i] });
      } else {
        collectLeaves(node[i], sink);
      }
    });
  } else if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) {
        continue;
      }
      if (typeof node[key] === 'string') {
        sink.push({ set: (v) => (node[key] = v), get: () => node[key] });
      } else {
        collectLeaves(node[key], sink);
      }
    }
  }
}

function translateBatch(strings, lang) {
  const prompt = `Translate each string in this JSON array from French to ${LANG_NAMES[lang]}.
Output ONLY a JSON array of the SAME length and order, nothing else.
Do NOT translate: code, identifiers, library/API names, URLs, the brand "super-dev"/".app". Keep numbers, emoji, and "mm:ss" timecodes verbatim. Keep it idiomatic for developers.

${JSON.stringify(strings, null, 2)}`;
  const out = extractArray(claude(prompt));

  if (!Array.isArray(out) || out.length !== strings.length) {
    throw new Error(`batch returned ${out.length} items for ${strings.length} inputs`);
  }

  return out;
}

function translateContent(lang) {
  const outPath = resolve(CONTENT_DIR, `content.${lang}.json`);

  if (existsSync(outPath) && !force) {
    console.log(`  · content.${lang}.json exists — skip`);

    return;
  }
  const data = JSON.parse(readFileSync(resolve(CONTENT_DIR, `content.${SOURCE}.json`), 'utf8'));
  const leaves = [];

  collectLeaves(data, leaves);
  console.log(`  content.${lang}.json — ${leaves.length} leaves in ${Math.ceil(leaves.length / BATCH)} batches`);
  for (let i = 0; i < leaves.length; i += BATCH) {
    const slice = leaves.slice(i, i + BATCH);
    const translated = translateBatch(slice.map((leaf) => leaf.get()), lang);

    slice.forEach((leaf, j) => leaf.set(translated[j]));
    process.stdout.write(`  ✓ batch ${i / BATCH + 1}\n`);
  }
  writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`✓ content.${lang}.json`);
}

function translateArticle(slug, lang) {
  const outPath = resolve(ARTICLES_DIR, `${slug}.${lang}.md`);

  if (existsSync(outPath) && !force) {
    console.log(`  · ${slug}.${lang}.md exists — skip`);

    return;
  }
  const md = readFileSync(resolve(ARTICLES_DIR, `${slug}.${SOURCE}.md`), 'utf8');
  const prompt = `Translate this Markdown technical article from French to ${LANG_NAMES[lang]}.
Output ONLY the translated Markdown, no commentary, no fence wrapping the whole document.
Translate PROSE ONLY. NEVER alter: fenced code blocks and their contents; inline \`code\`; frontmatter; URLs/links; HTML; technical identifiers, class/API names, CLI commands, library names (OnPush, signal(), dotnet, NgRx, EF Core…). Keep headings, lists, tables and structure exactly 1:1, same number of code fences.

${md}`;
  const out = extractMarkdown(claude(prompt));
  const fences = (s) => (s.match(/```/g) ?? []).length;

  if (!out.trim() || fences(out) !== fences(md)) {
    throw new Error(`${slug}.${lang}.md looks wrong (empty or code-fence count changed)`);
  }
  writeFileSync(outPath, out.endsWith('\n') ? out : `${out}\n`);
  console.log(`  ✓ ${slug}.${lang}.md`);
}

const slugs = slugArg
  ? [slugArg]
  : readdirSync(ARTICLES_DIR)
      .filter((f) => f.endsWith(`.${SOURCE}.md`))
      .map((f) => f.replace(`.${SOURCE}.md`, ''));

for (const lang of targets) {
  if (!LANG_NAMES[lang]) {
    throw new Error(`Unknown language "${lang}" — add it to LANG_NAMES in gen-i18n.mjs`);
  }
  console.log(`\n→ ${lang} (${LANG_NAMES[lang]})`);
  if (!slugArg) {
    translateContent(lang);
  }
  if (!contentOnly) {
    for (const slug of slugs) {
      translateArticle(slug, lang);
    }
  }
}
