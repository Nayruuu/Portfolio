/** A classified slice of a code line (see lib/tokenize). */
export interface Token {
  text: string;
  kind: '' | 'k' | 's' | 'c' | 'n' | 'a';
}
