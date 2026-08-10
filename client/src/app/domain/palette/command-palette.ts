/** UI micro-copy for the global ⌘K command palette (labels only — the searchable data is reused). */
export interface CommandPalette {
  /** Dialog accessible name. */
  title: string;
  /** Search input placeholder — invites the palette's full scope, not just article search. */
  placeholder: string;
  /** Group headers. */
  pages: string;
  articles: string;
  series: string;
  projects: string;
  actions: string;
  /** Action-row labels. */
  themeAction: string;
  langAction: string;
  copyLink: string;
  /** The "escape to the full articles grid" row shown while a query is present. */
  seeAll: string;
  /** Shown when nothing matches the query. */
  empty: string;
  /** Footer key hints (the label after each key glyph). */
  navHint: string;
  runHint: string;
  closeHint: string;
}
