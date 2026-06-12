import { Article } from './article/article';
import { ArticlesUi } from './article/articles-ui';
import { Aria } from './aria/aria';
import { Series } from './series/series';
import { SeriesUi } from './series/series-ui';
import { ProjectScene } from './project/project-scene';
import { ProjectThumb } from './project/project-thumb';
import { StackTab } from './stack/stack-tab';
import { About } from './about/about';
import { Contact } from './contact/contact';
import { Comment } from './comment/comment';
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
 * (labels/placeholders) and domain data (articles, series, chapters, comments…).
 */
export interface Content {
  brandTld: string;
  search: string;
  subscribe: string;
  subscribed: string;
  notification: string;
  join: string;
  cv: string;
  subscribers: string;
  videos: string;
  joined: string;
  openToWork: string;
  headerUptime: string;
  share: string;
  author: string;
  themeToDark: string;
  themeToLight: string;
  themeToggleAria: string;
  subscribersCount: string;
  videosCount: string;
  joinedYear: string;
  konamiTip: string;
  konamiKeys: string;
  tagsLabel: string;
  copy: string;
  copyDone: string;
  gameOver: string;
  gameControls: string; // compact in-game controls recap, ` · `-separated `[key] action` pairs (like `konamiKeys`)
  aria: Aria;

  bio: string;
  tabs: string[];

  featuredTitle: string;
  featuredViews: string;
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

  commentsCount: string;
  commentsSort: string;
  commentInputPh: string;
  commentPinned: string;
  commentYou: string;
  commentYouTag: string;
  commentJustNow: string;
  commentSend: string;
  comments: Comment[];

  upNext: UpNext;

  projects: ProjectThumb[];

  articleFilters: string[];
  articles: Article[];
  articlesUi: ArticlesUi;

  series: Series[];
  seriesUi: SeriesUi;

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
