/**
 * Kebab-case ASCII slug for a heading id/anchor: lowercased, accents stripped, every run of
 * non-alphanumerics collapsed to a single `-`, with leading/trailing dashes trimmed.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // NFD splits accents into combining marks; drop them
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
