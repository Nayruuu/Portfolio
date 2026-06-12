import { describe, it, expect } from 'vitest';
import { tokenize, LANG_LABEL } from '.';
import type { Token } from '../../domain';
import { type CodeLang } from '../../domain';

/** Helper: find the first token whose text equals `text`. */
function tokenOf(tokens: Token[], text: string): Token | undefined {
  return tokens.find((token) => token.text === text);
}

describe('tokenize', () => {
  it('classes a // comment as a comment token (kind="c")', () => {
    // The comment alternative captures `//` up to end of line.
    const tokens = tokenize('var x = 1; // hello world', 'typescript');
    const comment = tokenOf(tokens, '// hello world');

    expect(comment).toBeDefined();
    expect(comment?.kind).toBe('c');
  });

  it('classes a # comment as a comment token (kind="c")', () => {
    const tokens = tokenize('export PATH # set path', 'bash');
    const comment = tokenOf(tokens, '# set path');

    expect(comment).toBeDefined();
    expect(comment?.kind).toBe('c');
  });

  it('classes a backtick template string as a string token (kind="s")', () => {
    const tokens = tokenize('const s = `tpl`;', 'typescript');
    const str = tokenOf(tokens, '`tpl`');

    expect(str).toBeDefined();
    expect(str?.kind).toBe('s');
  });

  it('classes a double-quoted string as a string token (kind="s")', () => {
    const tokens = tokenize('var name = "John";', 'typescript');
    const str = tokenOf(tokens, '"John"');

    expect(str).toBeDefined();
    expect(str?.kind).toBe('s');
  });

  it('classes a single-quoted string as a string token (kind="s")', () => {
    const tokens = tokenize("const c = 'x';", 'typescript');
    const str = tokenOf(tokens, "'x'");

    expect(str).toBeDefined();
    expect(str?.kind).toBe('s');
  });

  it('classes a @decorator as an annotation token (kind="a")', () => {
    const tokens = tokenize('@Component', 'typescript');
    const annotation = tokenOf(tokens, '@Component');

    expect(annotation).toBeDefined();
    expect(annotation?.kind).toBe('a');
  });

  it('classes @Input as an annotation token (kind="a")', () => {
    const tokens = tokenize('@Input', 'typescript');
    const annotation = tokenOf(tokens, '@Input');

    expect(annotation).toBeDefined();
    expect(annotation?.kind).toBe('a');
  });

  it('classes a known typescript keyword (const) as keyword token (kind="k")', () => {
    const tokens = tokenize('const x = 1', 'typescript');
    const keyword = tokenOf(tokens, 'const');

    expect(keyword).toBeDefined();
    expect(keyword?.kind).toBe('k');
  });

  it('classes a known csharp keyword (public) as keyword token (kind="k")', () => {
    const tokens = tokenize('public void Foo', 'csharp');
    const keyword = tokenOf(tokens, 'public');

    expect(keyword).toBeDefined();
    expect(keyword?.kind).toBe('k');
  });

  it('classes a plain identifier as a default token (kind="")', () => {
    const tokens = tokenize('const myVar = 1', 'typescript');
    const identifier = tokenOf(tokens, 'myVar');

    expect(identifier).toBeDefined();
    expect(identifier?.kind).toBe('');
  });

  it('classes a bare number as a number token (kind="n")', () => {
    const tokens = tokenize('const x = 42', 'typescript');
    const number = tokenOf(tokens, '42');

    expect(number).toBeDefined();
    expect(number?.kind).toBe('n');
  });

  it('classes whitespace and operators between tokens as default (kind="")', () => {
    const tokens = tokenize('const x = 1', 'typescript');
    // The " = " segment between identifier `x` and number `1` is a default token.
    const gap = tokenOf(tokens, ' = ');

    expect(gap).toBeDefined();
    expect(gap?.kind).toBe('');
  });

  it('falls back to csharp keywords for an unknown language', () => {
    // `using` is a csharp keyword but NOT a typescript one; with an unknown
    // language the fallback (csharp) must classify it as a keyword.
    const tokens = tokenize('using System', 'klingon' as CodeLang);
    const keyword = tokenOf(tokens, 'using');

    expect(keyword).toBeDefined();
    expect(keyword?.kind).toBe('k');
  });

  it('does NOT treat a typescript-only keyword as keyword under csharp fallback', () => {
    // `let` is a typescript keyword but not a csharp one. Under the csharp
    // fallback it must be a plain identifier (kind=""), not a keyword.
    const tokens = tokenize('let value', 'klingon' as CodeLang);
    const identifier = tokenOf(tokens, 'let');

    expect(identifier).toBeDefined();
    expect(identifier?.kind).toBe('');
  });

  it('returns a single default token for a non-matching line', () => {
    const tokens = tokenize('   ', 'typescript');

    expect(tokens).toEqual([{ text: '   ', kind: '' }]);
  });

  it('returns an empty array for an empty line', () => {
    expect(tokenize('', 'typescript')).toEqual([]);
  });

  it('reconstructs the original line by concatenating token texts', () => {
    const line = 'const greeting = "hi"; // note';
    const tokens = tokenize(line, 'typescript');

    expect(tokens.map((token) => token.text).join('')).toBe(line);
  });

  it('tokenizes a decorator declaration: @Component annotation, class keyword, identifier plain', () => {
    const tokens = tokenize('@Component class Foo', 'typescript');

    expect(tokenOf(tokens, '@Component')?.kind).toBe('a');
    expect(tokenOf(tokens, 'class')?.kind).toBe('k');
    expect(tokenOf(tokens, 'Foo')?.kind).toBe('');
  });
});

describe('LANG_LABEL', () => {
  it('maps known language ids to display labels', () => {
    expect(LANG_LABEL['csharp']).toBe('C#');
    expect(LANG_LABEL['typescript']).toBe('TypeScript');
    expect(LANG_LABEL['yaml']).toBe('YAML');
    expect(LANG_LABEL['dart']).toBe('Dart');
    expect(LANG_LABEL['bash']).toBe('Bash');
  });
});
