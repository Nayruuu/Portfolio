import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown';

describe('parseMarkdown — blocks', () => {
  it('returns [] for empty / whitespace-only input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n\n  ')).toEqual([]);
  });

  it('normalises CRLF line endings', () => {
    expect(parseMarkdown('Hello\r\nworld')).toEqual(parseMarkdown('Hello\nworld'));
  });

  it('parses a paragraph (consecutive lines joined by space)', () => {
    expect(parseMarkdown('Hello\nworld')).toEqual([
      { type: 'p', runs: [{ kind: 'text', text: 'Hello world' }] },
    ]);
  });

  it('parses h2 and h3', () => {
    expect(parseMarkdown('## Title\n\n### Sub')).toEqual([
      { type: 'h2', runs: [{ kind: 'text', text: 'Title' }] },
      { type: 'h3', runs: [{ kind: 'text', text: 'Sub' }] },
    ]);
  });

  it('parses an unordered list', () => {
    expect(parseMarkdown('- one\n- two')).toEqual([
      { type: 'ul', items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] },
    ]);
  });

  it('parses an ordered list as a ul', () => {
    expect(parseMarkdown('1. one\n2. two')).toEqual([
      { type: 'ul', items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] },
    ]);
  });

  it('parses a fenced code block with a known lang (multi-line preserved)', () => {
    expect(parseMarkdown('```csharp\nvar x = 1;\nvar y = 2;\n```')).toEqual([
      { type: 'code', lang: 'csharp', text: 'var x = 1;\nvar y = 2;' },
    ]);
  });

  it('falls back to typescript for an absent or unknown fence lang', () => {
    expect(parseMarkdown('```\nfoo\n```')[0]).toEqual({
      type: 'code',
      lang: 'typescript',
      text: 'foo',
    });
    expect(parseMarkdown('```rust\nfoo\n```')[0]).toEqual({
      type: 'code',
      lang: 'typescript',
      text: 'foo',
    });
  });

  it('treats an unterminated fence as code to EOF', () => {
    expect(parseMarkdown('```bash\necho hi')).toEqual([
      { type: 'code', lang: 'bash', text: 'echo hi' },
    ]);
  });

  it('parses a blockquote, merging consecutive > lines', () => {
    expect(parseMarkdown('> a\n> b')).toEqual([
      { type: 'quote', runs: [{ kind: 'text', text: 'a b' }] },
    ]);
  });

  it('parses several blocks separated by blank lines, in order', () => {
    const blocks = parseMarkdown('## H\n\npara\n\n- li\n\n```yaml\nk: v\n```');

    expect(blocks.map((block) => block.type)).toEqual(['h2', 'p', 'ul', 'code']);
  });

  it('treats heading-like lines without a trailing space as paragraph text (terminates)', () => {
    expect(parseMarkdown('##nospace')).toEqual([
      { type: 'p', runs: [{ kind: 'text', text: '##nospace' }] },
    ]);
    expect(parseMarkdown('###x')).toEqual([{ type: 'p', runs: [{ kind: 'text', text: '###x' }] }]);
    expect(parseMarkdown('#### h4 unsupported')).toEqual([
      { type: 'p', runs: [{ kind: 'text', text: '#### h4 unsupported' }] },
    ]);
  });

  it('ends a paragraph at an immediately-following block opener (no blank line)', () => {
    expect(parseMarkdown('para\n## H').map((block) => block.type)).toEqual(['p', 'h2']);
    expect(parseMarkdown('para\n### H').map((block) => block.type)).toEqual(['p', 'h3']);
    expect(parseMarkdown('para\n> q').map((block) => block.type)).toEqual(['p', 'quote']);
    expect(parseMarkdown('para\n- li').map((block) => block.type)).toEqual(['p', 'ul']);
    expect(parseMarkdown('para\n```\nx\n```').map((block) => block.type)).toEqual(['p', 'code']);
  });

  it('leaves a malformed link (no closing paren) and a lone asterisk as literal text', () => {
    expect(parseMarkdown('see [docs](http://x')).toEqual([
      { type: 'p', runs: [{ kind: 'text', text: 'see [docs](http://x' }] },
    ]);
    expect(parseMarkdown('2 * 3 = 6')).toEqual([
      { type: 'p', runs: [{ kind: 'text', text: '2 * 3 = 6' }] },
    ]);
  });
});

describe('parseMarkdown — inline runs', () => {
  it('parses bold, code, and links', () => {
    expect(parseMarkdown('a **b** `c` [d](https://x.dev)')).toEqual([
      {
        type: 'p',
        runs: [
          { kind: 'text', text: 'a ' },
          { kind: 'bold', text: 'b' },
          { kind: 'text', text: ' ' },
          { kind: 'code', text: 'c' },
          { kind: 'text', text: ' ' },
          { kind: 'link', text: 'd', href: 'https://x.dev' },
        ],
      },
    ]);
  });

  it('leaves an unterminated marker as literal text', () => {
    expect(parseMarkdown('a **b')).toEqual([
      { type: 'p', runs: [{ kind: 'text', text: 'a **b' }] },
    ]);
  });

  it('parses inline runs inside headings and list items', () => {
    expect(parseMarkdown('## see `code`')[0]).toEqual({
      type: 'h2',
      runs: [
        { kind: 'text', text: 'see ' },
        { kind: 'code', text: 'code' },
      ],
    });
  });
});
