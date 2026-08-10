#!/usr/bin/env node
/**
 * Garde de couverture : impose 100% (statements/branches/functions/lines) sur
 * chaque fichier de `src/app/core/` — la logique métier pure du projet.
 *
 * Le builder `@angular/build:unit-test` ne supporte pas les seuils par-dossier
 * dans `coverageThresholds` (seuls les seuils globaux le sont). Ce script lit le
 * résumé JSON produit par le reporter `json-summary` et échoue (exit 1) si un
 * fichier core/ descend sous 100%. À lancer APRÈS `ng test --coverage`.
 */
import { readFileSync } from 'node:fs';

const SUMMARY = 'coverage/super-dev-portfolio/coverage-summary.json';
const METRICS = ['statements', 'branches', 'functions', 'lines'];

let summary;
try {
  summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
} catch {
  console.error(`✗ Résumé de couverture introuvable: ${SUMMARY}`);
  console.error("  Lance d'abord: npm test -- --coverage");
  process.exit(1);
}

const failures = [];
for (const [file, data] of Object.entries(summary)) {
  if (file === 'total') continue;
  if (!file.includes('/core/') || file.endsWith('.spec.ts')) continue;
  const under = METRICS.filter((m) => data[m].pct < 100);
  if (under.length) {
    const rel = file.split('/app/').pop() ?? file;
    failures.push(`  ${rel} → ${under.map((m) => `${m}:${data[m].pct}%`).join(', ')}`);
  }
}

if (failures.length) {
  console.error('✗ core/ doit être couvert à 100% — fichiers en dessous :');
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('✓ core/ couvert à 100% (statements, branches, functions, lines)');
