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
}
