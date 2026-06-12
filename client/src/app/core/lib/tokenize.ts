import type { CodeLang, Token } from '../../domain';

const KEYWORDS: Record<CodeLang, RegExp> = {
  csharp:
    /\b(var|new|using|public|private|class|return|void|async|await|builder|app|sealed|namespace|record|init|set|get|if|else|foreach|in|for|switch|case|default|null|true|false|this|throw|catch|try|finally|static|readonly|const|interface|abstract|override)\b/,
  typescript:
    /\b(const|let|var|function|class|interface|extends|implements|return|if|else|for|while|switch|case|default|null|true|false|this|import|export|from|as|async|await|public|private|readonly|static|new|throw|catch|try|finally|type)\b/,
  yaml: /\b(stages|stage|jobs|job|steps|task|inputs|trigger|pool|displayName|condition|dependsOn|variables)\b/,
  dart: /\b(class|extends|implements|with|abstract|final|const|var|void|return|if|else|for|while|switch|case|default|null|true|false|this|new|throw|catch|try|finally|import|export|library|part|of|async|await|Future|Stream|Widget)\b/,
  bash: /\b(az|terraform|git|docker|kubectl|helm|npm|dotnet|ng|flutter|mkdir|cd|export|source|if|then|else|fi|for|do|done|while|case|esac|resource)\b/,
};

/** Minimal multi-language tokenizer for code blocks. */
export function tokenize(line: string, lang: CodeLang): Token[] {
  const tokens: Token[] = [];
  const keywords = KEYWORDS[lang] ?? KEYWORDS.csharp;
  const regex = new RegExp(
    '(\\/\\/[^\\n]*|#[^\\n]*)|' +
      '("[^"]*"|\'[^\']*\'|`[^`]*`)|' +
      '(\\b\\d+\\b)|' +
      // `keywords.source` is `\b(…)\b`; slicing off the `\b` anchors keeps its OWN capture group,
      // so it IS group 4 — do not re-wrap it (that shifted every later group, leaving the decorator
      // alternative unreachable as a dead `'a'` kind).
      keywords.source.slice(2, -2) +
      '|' +
      '(@[A-Za-z]+)|' +
      '([A-Za-z_][A-Za-z0-9_]*)',
    'g',
  );
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line))) {
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index), kind: '' });
    }
    if (match[1]) {
      tokens.push({ text: match[1], kind: 'c' });
    } else if (match[2]) {
      tokens.push({ text: match[2], kind: 's' });
    } else if (match[3]) {
      tokens.push({ text: match[3], kind: 'n' });
    } else if (match[4]) {
      tokens.push({ text: match[4], kind: 'k' });
    } else if (match[5]) {
      tokens.push({ text: match[5], kind: 'a' });
    } else {
      tokens.push({ text: match[0], kind: '' });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), kind: '' });
  }

  return tokens;
}
