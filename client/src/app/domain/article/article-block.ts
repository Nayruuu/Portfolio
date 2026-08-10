import { CodeLang } from '../code/code-lang';
import { InlineRun } from './inline-run';

/** A rendered block inside an article body. Text-bearing blocks carry inline runs. */
export type ArticleBlock =
  | { type: 'p'; runs: InlineRun[] }
  | { type: 'h2'; runs: InlineRun[] }
  | { type: 'h3'; runs: InlineRun[] }
  | { type: 'ul'; items: InlineRun[][] }
  | { type: 'code'; lang: CodeLang; text: string }
  | { type: 'quote'; runs: InlineRun[] };
