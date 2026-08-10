export interface ProjectScene {
  number: string;
  name: string;
  role: string;
  description: string;
  stack: string[];
  metric: string;
  tag: string;
  /** Set on projects with a dedicated `/projects/:slug` page; joined to the `PROJECTS` meta map. */
  slug?: string;
  /** Case-study narrative: the constraint the project answers. Rendered only when present. */
  problem?: string;
  /** Case-study narrative: how the constraint is solved. Rendered only when present. */
  approach?: string;
  /** Case-study bullet list of the project's defining traits. Rendered only when present. */
  highlights?: string[];
  /** Translated alt text for the case-study preview image (`ProjectMeta.image`) — a11y. */
  imageAlt?: string;
}
