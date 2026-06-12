import type { ArticleBlock, CodeLang, InlineRun } from '../../domain';
import { LANG_LABEL } from './lang-label';

const CODE_LANGS = Object.keys(LANG_LABEL) as readonly CodeLang[];
const FALLBACK_LANG: CodeLang = 'typescript';

/** Narrows a fenced-code info string to a known `CodeLang`. */
function isCodeLang(value: string): value is CodeLang {
  return (CODE_LANGS as readonly string[]).includes(value);
}

/** Parse a Markdown body (our tight subset) into renderable `ArticleBlock[]`. */
export function parseMarkdown(body: string): ArticleBlock[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: ArticleBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index++;
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/);

    if (fence) {
      const lang: CodeLang = isCodeLang(fence[1]) ? fence[1] : FALLBACK_LANG;
      const codeLines: string[] = [];

      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index++;
      }
      index++;
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      continue;
    }

    const h3 = line.match(/^###\s+(.*)$/);

    if (h3) {
      blocks.push({ type: 'h3', runs: parseInline(h3[1]) });
      index++;
      continue;
    }

    const h2 = line.match(/^##\s+(.*)$/);

    if (h2) {
      blocks.push({ type: 'h2', runs: parseInline(h2[1]) });
      index++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];

      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index++;
      }
      blocks.push({ type: 'quote', runs: parseInline(quoteLines.join(' ')) });
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: InlineRun[][] = [];

      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        items.push(parseInline(lines[index].replace(/^\s*([-*]|\d+\.)\s+/, '')));
        index++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Paragraph: the current line opened no block above. Always consume it (guaranteeing
    // forward progress), then absorb following non-blank, non-block-opening lines.
    const paraLines: string[] = [lines[index].trim()];

    index++;
    while (index < lines.length && lines[index].trim() !== '' && !opensBlock(lines[index])) {
      paraLines.push(lines[index].trim());
      index++;
    }
    blocks.push({ type: 'p', runs: parseInline(paraLines.join(' ')) });
  }

  return blocks;
}

/** Whether a line opens a non-paragraph block — mirrors the matchers in parseMarkdown's main loop. */
function opensBlock(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^#{2,3}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*([-*]|\d+\.)\s+/.test(line)
  );
}

/** Parse inline `**bold**`, `` `code` ``, `[text](url)`; everything else is text. */
function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer) {
      runs.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };

  while (index < text.length) {
    const rest = text.slice(index);
    const code = rest.match(/^`([^`]+)`/);

    if (code) {
      flush();
      runs.push({ kind: 'code', text: code[1] });
      index += code[0].length;
      continue;
    }

    const bold = rest.match(/^\*\*([^*]+)\*\*/);

    if (bold) {
      flush();
      runs.push({ kind: 'bold', text: bold[1] });
      index += bold[0].length;
      continue;
    }

    const link = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/);

    if (link) {
      flush();
      runs.push({ kind: 'link', text: link[1], href: link[2] });
      index += link[0].length;
      continue;
    }

    buffer += text[index];
    index++;
  }
  flush();

  return runs;
}
