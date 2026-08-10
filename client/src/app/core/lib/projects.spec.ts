import { describe, it, expect } from 'vitest';
import { PROJECTS, PROJECT_SLUGS, type ProjectMeta } from './projects';

describe('PROJECTS', () => {
  it('lists exactly the projects that have a page', () => {
    expect(PROJECT_SLUGS).toEqual(['open-space-exe', 'ngsharp', 'fluentgraphql', 'universe-map']);
  });

  it('exposes only absolute https links and a primary language per project', () => {
    for (const meta of Object.values(PROJECTS) as ProjectMeta[]) {
      expect(meta.programmingLanguage.length).toBeGreaterThan(0);
      expect(meta.repo).toMatch(/^https:\/\/github\.com\//);
      // Every listed project is verified MIT — a future non-MIT addition must trip this.
      expect(meta.license).toBe('https://opensource.org/licenses/MIT');

      for (const link of [meta.nuget, meta.docs, meta.live].filter(Boolean)) {
        expect(link).toMatch(/^https:\/\//);
      }
    }
  });
});
