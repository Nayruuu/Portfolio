import { Article } from './article/article';
import { ArticlesUi } from './article/articles-ui';
import { Aria } from './aria/aria';
import { Series } from './series/series';
import { SeriesUi } from './series/series-ui';
import { ProjectScene } from './project/project-scene';
import { ProjectsUi } from './project/projects-ui';
import { StackTab } from './stack/stack-tab';
import { About } from './about/about';
import { Contact } from './contact/contact';
import { Discuss } from './discuss/discuss';
import { ReviewsBlock } from './review/reviews-block';
import { Chapter } from './player/chapter';
import { SceneIntro } from './player/scene-intro';
import { SceneOutro } from './player/scene-outro';
import { SceneProjects } from './player/scene-projects';
import { SceneStack } from './player/scene-stack';
import { SceneTimeline } from './player/scene-timeline';
import { UpNext } from './player/up-next';

/**
 * The multilingual content contract. Typing every `content.<lang>.ts` bridge as `Content`
 * guarantees all locales stay structurally aligned at compile time. Holds both UI micro-copy
 * (labels/placeholders) and domain data (articles, series, chapters…).
 */
export interface Content {
  brandTld: string;
  search: string;
  notification: string;
  join: string;
  cv: string;
  cvUrl: string;
  joined: string;
  headerUptime: string;
  share: string;
  author: string;
  themeToDark: string;
  themeToLight: string;
  themeToggleAria: string;
  joinedYear: string;
  konamiTip: string;
  konamiKeys: string;
  tagsLabel: string;
  copy: string;
  copyDone: string;
  beFirst: string;
  gameOver: string;
  gameControls: string; // compact in-game controls recap, ` · `-separated `[key] action` pairs (like `konamiKeys`)
  aria: Aria;

  bio: string;
  metaTitle: string; // home <title> tail (`{author} — {metaTitle}`), authored ≤ ~48 chars
  tabs: string[];
  tabDescriptions: string[]; // per-tab meta description, index-aligned with `tabs`

  featuredTitle: string;
  featuredWhen: string;
  featuredCategory: string;
  featuredTags: string[];

  descriptionMeta: string[];
  descriptionMetaValues: string[];
  descriptionBody: string;

  chapters: Chapter[];
  totalSec: number;
  chaptersLabel: string;
  /** Label on the inline player's "popped out to mini-player" placeholder. */
  playerRestore: string;

  upNext: UpNext;

  articleFilters: string[];
  /** Real, attributed Malt recommendations (the honest replacement for fake testimonials). */
  reviews: ReviewsBlock;
  /** The honest end-of-home CTA that replaced the simulated comments section. */
  discuss: Discuss;
  articles: Article[];
  articlesUi: ArticlesUi;

  series: Series[];
  seriesUi: SeriesUi;

  projectsUi: ProjectsUi;

  sceneIntro: SceneIntro;
  sceneStack: SceneStack;
  sceneProjects: SceneProjects;
  projectScenes: ProjectScene[];
  sceneTimeline: SceneTimeline;
  sceneOutro: SceneOutro;

  about: About;
  stackTab: StackTab;
  contact: Contact;
}
