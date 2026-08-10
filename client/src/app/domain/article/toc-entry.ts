/** One heading in an article's table of contents — `level` is 2 (`h2`) or 3 (`h3`). */
export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}
