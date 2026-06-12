import type { CodeLang } from '../../domain';

/** Human display label per code language (drives the code-block chrome). */
export const LANG_LABEL: Record<CodeLang, string> = {
  csharp: 'C#',
  typescript: 'TypeScript',
  yaml: 'YAML',
  dart: 'Dart',
  bash: 'Bash',
};
