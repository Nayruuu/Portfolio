import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { PaletteService } from '../../core/services/palette/palette.service';
import { SearchService } from '../../core/services/search/search.service';
import { ThemeService } from '../../core/services/theme/theme.service';
import { highlightMatch, paletteMatch, pathInLang, PROJECTS, TAB_SEGMENTS } from '../../core/lib';
import { LANGS, THEME, type Content, type Lang } from '../../domain';
import { IconComponent, type IconName } from '../icon/icon.component';

type PaletteGroup = 'pages' | 'articles' | 'series' | 'projects' | 'actions';

interface PaletteItem {
  id: string;
  group: PaletteGroup;
  icon: IconName;
  /** Brand accent (article/series) that tints the mono `icon`; absent on pages/actions. */
  color?: string;
  label: string;
  sub: string;
  run: () => void;
}

interface PaletteRow {
  item: PaletteItem;
  /** Flat position across all groups — what `selected` indexes for keyboard navigation. */
  index: number;
  segments: { text: string; hit: boolean }[];
}

interface PaletteGroupView {
  key: PaletteGroup;
  label: string;
  rows: PaletteRow[];
}

const GROUP_ORDER: readonly PaletteGroup[] = ['pages', 'articles', 'series', 'projects', 'actions'];

/** The palette shows only the top few articles; "see all results" routes to the full grid. */
const ARTICLE_LIMIT = 4;

/** Icon tint for project rows (articles/series carry their own brand colour, pages stay mono). */
const PROJECT_COLOR = 'oklch(70% 0.17 150deg)';

/** Icon per page, index-aligned with `TAB_SEGMENTS` / `content.tabs`. */
const PAGE_ICONS: readonly IconName[] = ['home', 'articles', 'projects', 'about', 'layers', 'mail'];

/** Icon tint per page (index-aligned) — a hue-wheel spread so the menu reads colourful, like the mock-up. */
const PAGE_COLORS: readonly string[] = [
  'oklch(68% 0.18 22deg)', // home — red
  'oklch(72% 0.16 55deg)', // articles — orange
  'oklch(72% 0.16 150deg)', // projects — green
  'oklch(70% 0.12 200deg)', // about — teal
  'oklch(68% 0.15 250deg)', // stack — blue
  'oklch(64% 0.16 300deg)', // contact — violet
];

/**
 * Global ⌘K command palette — an overlay search over every page, article, series, project and a
 * handful of actions. Absorbs the nav search box (now a trigger). The playable game is never listed
 * (hidden easter egg). SSR-safe: closed by default, so prerender renders nothing.
 */
@Component({
  selector: 'sd-command-palette',
  styleUrl: './command-palette.component.scss',
  templateUrl: './command-palette.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class CommandPaletteComponent {
  protected readonly palette = inject(PaletteService);
  protected readonly i18n = inject(I18nService);
  protected readonly theme = inject(ThemeService);
  protected readonly query = signal('');
  protected readonly selected = signal(0);
  protected readonly groups = computed<PaletteGroupView[]>(() => this.buildGroups());
  protected readonly empty = computed(
    () => this.query().trim() !== '' && this.matched().length === 0,
  );
  /** `aria-activedescendant` for the input combobox — the id of the virtually-highlighted row. */
  protected readonly activeId = computed(() => {
    const row = this.flat()[this.selected()];

    return row === undefined ? null : `cmdk-option-${row.item.id}`;
  });

  private readonly search = inject(SearchService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly dialogRef = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly baseItems = computed<PaletteItem[]>(() => this.buildItems());
  private readonly matched = computed<PaletteItem[]>(() => {
    const query = this.query().trim();

    return this.baseItems().filter((item) => paletteMatch(`${item.label} ${item.sub}`, query));
  });
  private readonly flat = computed<PaletteRow[]>(() =>
    this.groups().flatMap((group) => group.rows),
  );
  private previousFocus: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.palette.open()) {
        this.previousFocus = this.doc.activeElement as HTMLElement | null;
        this.query.set('');
        this.selected.set(0);
        afterNextRender(() => this.inputRef()?.nativeElement.focus(), { injector: this.injector });
      } else {
        this.previousFocus?.focus();
      }
    });
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.selected.set(0);
  }

  protected runItem(item: PaletteItem): void {
    item.run();
    this.palette.close();
  }

  protected close(): void {
    this.palette.close();
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.palette.toggle();

      return;
    }
    if (this.palette.open()) {
      this.onOpenKeydown(event);

      return;
    }
    if (event.key === '/' && !this.isTypingTarget(event.target)) {
      event.preventDefault();
      this.palette.show();
    }
  }

  private onOpenKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.move(-1);
        break;
      case 'Enter':
        event.preventDefault();
        this.runSelected();
        break;
      case 'Escape':
        event.preventDefault();
        this.palette.close();
        break;
      case 'Tab':
        this.trapTab(event);
        break;
      default:
        break;
    }
  }

  private move(delta: number): void {
    const count = this.flat().length;

    if (count === 0) {
      return;
    }
    this.selected.update((current) => (current + delta + count) % count);
  }

  private runSelected(): void {
    const row = this.flat()[this.selected()];

    if (row !== undefined) {
      this.runItem(row.item);
    }
  }

  private trapTab(event: KeyboardEvent): void {
    const dialog = this.dialogRef()?.nativeElement;

    if (dialog === undefined) {
      return;
    }
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])',
    );

    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && this.doc.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      target.closest('input, textarea, select, [contenteditable]') !== null
    );
  }

  /** Cycles to the next language in `LANGS` and routes to the same path in it (never `setLang`). */
  private switchLang(): void {
    const next = LANGS[(LANGS.indexOf(this.i18n.lang()) + 1) % LANGS.length];

    void this.router.navigateByUrl(pathInLang(this.router.url.split(/[?#]/)[0], next));
  }

  private copyLink(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    void navigator.clipboard?.writeText(location.href);
  }

  private buildGroups(): PaletteGroupView[] {
    const query = this.query().trim();
    const labels = this.i18n.content().palette;
    const matched = this.matched();
    const groupLabel: Record<PaletteGroup, string> = {
      pages: labels.pages,
      articles: labels.articles,
      series: labels.series,
      projects: labels.projects,
      actions: labels.actions,
    };
    let index = 0;
    const views: PaletteGroupView[] = [];

    for (const key of GROUP_ORDER) {
      let items = matched.filter((item) => item.group === key);

      // Articles are capped to the top few; a "see all results" row escapes to the full grid.
      if (key === 'articles') {
        items = items.slice(0, ARTICLE_LIMIT);

        if (query !== '' && items.length > 0) {
          items = [...items, this.seeAllItem(query)];
        }
      }
      const groupRows = items.map((item) => ({
        item,
        index: index++,
        segments: highlightMatch(item.label, query),
      }));

      if (groupRows.length > 0) {
        views.push({ key, label: groupLabel[key], rows: groupRows });
      }
    }

    return views;
  }

  private buildItems(): PaletteItem[] {
    const content = this.i18n.content();
    const lang = this.i18n.lang();

    return [
      ...this.buildPages(content, lang),
      ...this.buildArticles(content, lang),
      ...this.buildSeries(content, lang),
      ...this.buildProjects(content, lang),
      ...this.buildActions(content),
    ];
  }

  private buildPages(content: Content, lang: Lang): PaletteItem[] {
    return TAB_SEGMENTS.map((segment, index) =>
      this.link(
        `page:${segment || 'home'}`,
        'pages',
        PAGE_ICONS[index],
        content.tabs[index],
        '',
        segment === '' ? ['/', lang] : ['/', lang, segment],
        { color: PAGE_COLORS[index] },
      ),
    );
  }

  private buildArticles(content: Content, lang: Lang): PaletteItem[] {
    return content.articles.map((article) =>
      this.link(
        `article:${article.slug}`,
        'articles',
        'articles',
        article.title,
        article.tag,
        ['/', lang, 'articles', article.slug],
        { color: article.accentColor },
      ),
    );
  }

  private buildSeries(content: Content, lang: Lang): PaletteItem[] {
    return content.series.map((entry) =>
      this.link(
        `series:${entry.slug}`,
        'series',
        'series',
        entry.title,
        entry.description,
        ['/', lang, 'series', entry.slug],
        { color: entry.colors[0] },
      ),
    );
  }

  private buildProjects(content: Content, lang: Lang): PaletteItem[] {
    return content.projectScenes.flatMap((scene) => {
      const slug = scene.slug;

      if (slug === undefined || !(slug in PROJECTS)) {
        return [];
      }

      return [
        this.link(
          `project:${slug}`,
          'projects',
          'layers',
          scene.name,
          scene.role,
          ['/', lang, 'projects', slug],
          { color: PROJECT_COLOR },
        ),
      ];
    });
  }

  private buildActions(content: Content): PaletteItem[] {
    return [
      {
        id: 'action:theme',
        group: 'actions',
        icon: this.theme.theme() === THEME.LIGHT ? 'moon' : 'sun',
        color: 'oklch(80% 0.15 85deg)',
        label: content.palette.themeAction,
        sub: '',
        run: () => this.theme.toggle(),
      },
      {
        id: 'action:lang',
        group: 'actions',
        icon: 'gear',
        color: 'oklch(68% 0.15 250deg)',
        label: content.palette.langAction,
        sub: '',
        run: () => this.switchLang(),
      },
      {
        id: 'action:copy',
        group: 'actions',
        icon: 'share',
        color: 'oklch(70% 0.16 190deg)',
        label: content.palette.copyLink,
        sub: '',
        run: () => this.copyLink(),
      },
    ];
  }

  /** The "see all results" escape hatch — seeds the grid filter and routes to the articles list. */
  private seeAllItem(query: string): PaletteItem {
    const lang = this.i18n.lang();

    return {
      id: 'action:see-all',
      group: 'articles',
      icon: 'search',
      label: this.i18n.content().palette.seeAll,
      sub: query,
      run: () => {
        this.search.query.set(query);
        void this.router.navigate(['/', lang, 'articles']);
      },
    };
  }

  private link(
    id: string,
    group: PaletteGroup,
    icon: IconName,
    label: string,
    sub: string,
    commands: string[],
    accent?: Pick<PaletteItem, 'color'>,
  ): PaletteItem {
    return {
      id,
      group,
      icon,
      ...accent,
      label,
      sub,
      run: () => void this.router.navigate(commands),
    };
  }
}
