import type { CodeLang } from '../../domain';

/**
 * Canonical, locale-invariant metadata for the open-source projects that get a dedicated page
 * (`/projects/:slug`). Kept in code next to the other identity anchors (`SOCIAL_URLS`, `PERSON`) so
 * the same URLs feed both the visible link row and the `SoftwareSourceCode` JSON-LD `sameAs`. The
 * translated display fields (name, role, description, stack…) stay in `projectScenes`, joined by
 * `slug`. OPEN SPACE.EXE links to its article + engine source, never to the playable `/bsp` route —
 * the easter egg's *location* stays hidden even though the engine is now a listed work.
 */
export interface ProjectMeta {
  /** Public source repository (every listed project is open source). */
  repo: string;
  /** Primary language for `SoftwareSourceCode.programmingLanguage`. */
  programmingLanguage: string;
  /** SPDX license URL — asserted per-project in the JSON-LD, so it is never a blanket assumption. */
  license: string;
  nuget?: string;
  docs?: string;
  live?: string;
  /** On-site deep-dive article slug, if the project has one — links out, never duplicated. */
  article?: string;
  /** A short, illustrative snippet for the case-study "In practice" section — rendered via `sd-code-block`. */
  codeSample?: { lang: CodeLang; source: string };
  /** Locale-invariant case-study preview screenshot — an `Aperçu` shown for the visual projects in
   * place of the code sample; alt text lives in `projectScenes`. Intrinsic `width`/`height` reserve
   * the box so the lazy image doesn't shift layout as it loads. */
  image?: { src: string; width: number; height: number };
}

/** Every listed project is verified MIT (repo LICENSE files checked). */
const MIT = 'https://opensource.org/licenses/MIT';

export const PROJECTS = {
  'open-space-exe': {
    // The engine lives in the public portfolio repo under `core/lib` (the pure BSP renderer in
    // `bsp-engine/` + the game logic/host in `game/`) — no `/bsp` link on purpose.
    repo: 'https://github.com/Nayruuu/Portfolio/tree/main/client/src/app/core/lib',
    programmingLanguage: 'TypeScript',
    license: MIT,
    article: 'moteur-doom-software-webgpu',
    image: { src: '/projects/open-space-exe.webp', width: 1100, height: 804 },
  },
  ngsharp: {
    repo: 'https://github.com/Nayruuu/NgSharp',
    programmingLanguage: 'C#',
    license: MIT,
    nuget: 'https://www.nuget.org/packages/NgSharp',
    docs: 'https://nayruuu.github.io/NgSharp/',
    article: 'ngsharp-moteur-templates-interprete',
    codeSample: {
      lang: 'csharp',
      source: `var builder = HtmlBuilder.Create();
var html = builder.BuildFromTemplate(
    "<ul>@for (u of Users) {<li>{{ u.Name | upper }}</li>}</ul>",
    new { Users = new[] { new { Name = "ada" }, new { Name = "linus" } } });
// → <ul><li>ADA</li><li>LINUS</li></ul>`,
    },
  },
  fluentgraphql: {
    repo: 'https://github.com/Nayruuu/FluentGraphQL',
    programmingLanguage: 'C#',
    license: MIT,
    nuget: 'https://www.nuget.org/packages/FluentGraphQL',
    docs: 'https://nayruuu.github.io/FluentGraphQL/',
    article: 'orchestration-sans-base-graphql-dotnet',
    codeSample: {
      lang: 'csharp',
      source: `builder.AddQuery(
    new GraphQLQueryObject<Account>("accounts")
        .AddEveryFields()
        .AddCollectionField(a => a.Contacts)
        .Where(a => cities.Contains(a.Adresse.City)));`,
    },
  },
  'universe-map': {
    repo: 'https://github.com/Nayruuu/my-universe',
    programmingLanguage: 'TypeScript',
    license: MIT,
    live: 'https://super-universe.app',
    article: 'universe-map-moteur-eclipses',
    image: { src: '/projects/universe-map.webp', width: 1280, height: 720 },
  },
} as const satisfies Record<string, ProjectMeta>;

/** The slugs with a dedicated page — the SSG prerender + sitemap source of truth. */
export const PROJECT_SLUGS = Object.keys(PROJECTS);
