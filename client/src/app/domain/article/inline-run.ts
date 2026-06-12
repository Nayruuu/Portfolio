/** An inline span inside a text block (paragraph / heading / quote / list item). */
export interface InlineRun {
  kind: 'text' | 'bold' | 'code' | 'link';
  text: string;
  /** Present only when `kind === 'link'`. */
  href?: string;
}
