import { ContactKind } from './contact-kind';

export interface ContactMethod {
  /** Data (lives in content.*.json); `iconOf` returns a `'•'` fallback for any value outside `ContactKind` (defensive against malformed JSON). */
  kind: ContactKind;
  label: string;
  subtitle: string;
}
