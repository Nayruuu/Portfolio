---
name: angular-rules
description: Project's in-house Angular conventions (standalone, zoneless, signals, native control flow, separate templates/styles, multilingual i18n, OnPush). TRIGGER when creating/editing an Angular component or service, adding an input/output, handling reactive state, or writing a template/route. SKIP for non-Angular questions.
---

# Angular 21 — apply the project conventions

Technical-showcase project (`sd-` prefix): the code must exemplify modern Angular 21. This skill is
**operational** — how to apply the rules while authoring a component, service, route, or template. It
does **not** restate the rules; the canonical rulebooks own them. **Read the relevant doc, then build
to the skeleton below.**

## Rulebooks (the rules live here — read before authoring)

| When you are… | Read |
| --- | --- |
| writing a component/service `.ts` (shape, signals, accessibility, member order, control flow, types, no-enum, naming, ESLint statement rules) | [`.claude/conventions/code.md`](../../conventions/code.md) |
| deciding **where** a file/type goes, which way it imports, barrels, one-declaration-per-file, the typed content bridge, routing/SEO placement | [`.claude/conventions/architecture.md`](../../conventions/architecture.md) |
| writing a `.scss` (CSS tokens, one-level BEM nesting, blank-line rule, tabs, shared-vs-co-located, `:host-context` theme, no inline `style=`) | [`.claude/conventions/design.md`](../../conventions/design.md) |
| writing a spec or running the gates (Vitest/Playwright, coverage thresholds, `core/` 100 % guard, prerender guard) | [`.claude/conventions/testing.md`](../../conventions/testing.md) |

If the docs and the code ever disagree, **the code wins** — fix the doc, don't copy the drift.

## Component skeleton

Build to this shape; the rules it embodies (`@Component` key order, member order, accessibility-by-audience,
signal primitives, OnPush, native control flow) are owned by [`code.md`](../../conventions/code.md) §1–§5.

    // comment-item.component.ts
    import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
    import { I18nService } from '../../core/services/i18n/i18n.service';
    import { IconComponent } from '../../shared/icon/icon.component';
    import type { Comment } from '../../domain';

    @Component({
      selector: 'sd-comment-item',
      host: { class: 'comment' },
      styleUrl: './comment-item.component.scss',
      templateUrl: './comment-item.component.html',
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [IconComponent],
    })
    export class CommentItemComponent {
      public readonly data = input.required<Comment>();   // bound by a parent → public
      public readonly flag = output<string>();              // parent listens → public

      protected readonly i18n = inject(I18nService);         // read in template → protected
      protected readonly liked = signal(false);             // public primitive WOULD need a signal; this is protected but still a signal
      protected readonly handle = computed(() =>            // derived state is computed(), never a duplicated field
        this.data().who.replace(/\s/g, '').toLowerCase(),
      );

      private readonly store = inject(SomeStore);           // internal only → private

      protected toggleLike(): void {                        // methods after fields
        this.liked.update((current) => !current);           // braces on every block (curly:all)
      }
    }

    <!-- comment-item.component.html  (native control flow only; every @for has track) -->
    @if (data().pinned) {
      <span class="comment__badge">{{ i18n.content().comments.pinned }}</span>
    }
    @for (line of data().lines; track line.id) {
      <p>{{ line.text }}</p>
    }

Queries use `viewChild<ElementRef<HTMLDivElement>>('ref')` and read `this.ref()?.nativeElement` —
never `@ViewChild`. Detail components read a route param via `input.required<string>()` (see Routing).

## Service skeleton

Reactive state in a root service: `inject()` DI, signals-only, an `effect()` that owns a timer cleans up
in `onCleanup` (the `PlayerService` `setInterval` is the reference; see CLAUDE.md "Known gotchas").

    @Injectable({ providedIn: 'root' })
    export class PlayerService {
      public readonly time = signal(0);
      public readonly playing = signal(true);
      public readonly currentChapter = computed<Chapter>(() => /* derived from time */ …);

      private readonly i18n = inject(I18nService);

      constructor() {
        effect((onCleanup) => {
          if (!this.playing()) {
            return;                                          // newline-before-return is enforced
          }
          const intervalId = setInterval(() => this.time.update((t) => t + 0.1), 100);

          onCleanup(() => clearInterval(intervalId));        // ALWAYS clean up the timer
        });
      }
    }

State layering (when to use the NgRx SignalStore vs a facade vs a plain signal service) is an architecture
concern — see [`architecture.md`](../../conventions/architecture.md) §5 (the `content/` store +
`i18n/` facade).

## i18n — reading a displayed string

Inject `I18nService`, read text via `i18n.content()`; a new string is added to the **FR source** JSON
(then `make i18n` regenerates the other locales). The typed bridge and multilingual `Content` contract are owned by
[`architecture.md`](../../conventions/architecture.md) §5; the "never select text with a
`i18n.lang() === 'fr' ? … : …` ternary" rule is owned by [`code.md`](../../conventions/code.md) §5.

```ts
// in a component
protected readonly i18n = inject(I18nService);
// template:  {{ i18n.content().contact.subjects[0] }}
```

`i18n.lang()` *is* fine inside a `routerLink` — that's routing, not text (see Routing). For an exhaustive
`switch` over a closed union, end with `default: kind satisfies never;` (`ContactComponent.iconOf` is the
reference) so a new variant fails to compile.

## Routing — patterns (rules in `architecture.md`)

Language as a URL prefix via one static tree per `Lang` (`/fr` `/en` `/es` `/de`, generated from `LANGS`;
never a `:lang` param), the `langResolver`, and route-as-language-source are owned by
[`architecture.md`](../../conventions/architecture.md). Apply them like this:

- `app.routes.ts`: the trees are built `LANGS.map(...)`, each carrying `resolve: { lang: langResolver }`
  over shared lazy `langChildren()`; `/` and `**` redirect to `/${DEFAULT_LANG}` with static strings.
  Features with internal routing expose `*.routes.ts`
  via `loadChildren`; simple pages use `loadComponent`. `app.config.ts` wires
  `provideRouter(routes, withComponentInputBinding())`.

- `routerLink`s are **lang-prefixed** — build them as `['/', i18n.lang(), segment]` (see
  `TabsBarComponent.links`), not hardcoded `/fr/...`.
- the language **picker** (`@for` over `LANGS`) **navigates to the same path in the chosen `Lang`**
  (swap segment 0), it does **not** call `setLang` directly (`NavComponent.switchLang`).
- detail components read `:slug` via `input.required<string>()` (bound by `withComponentInputBinding`)
  and resolve the entry with `findIndex(x.slug === slug())` (`ArticleDetailComponent`).

## Styles — pointer

A component gets its own `.scss`; all SCSS/design rules (tokens-only, one-level BEM nesting, blank-line,
tabs, shared-vs-co-located placement, `:host-context` theme overrides, when `[style.x]` is allowed) are
owned by [`design.md`](../../conventions/design.md) — and the `design` skill is the operational
companion for them.

## Common mistakes (symptom → what catches it)

Pointers, not rule statements — each links the catching gate/doc:

- Inline `template:`/`styles:`/`animations:` in `@Component` → ESLint
  `component-max-inline-declarations` fails ([`code.md`](../../conventions/code.md) §1).
- Constructor DI `constructor(private x: X)`, or legacy `@Input()/@Output()/@ViewChild()`, or a public
  non-signal primitive → `inject()`/signal-input rules + `local/prefer-signal-primitives`
  ([`code.md`](../../conventions/code.md) §1–§3).
- Missing explicit accessibility or wrong member order → `explicit-member-accessibility` /
  `member-ordering` ([`code.md`](../../conventions/code.md) §4).
- `*ngIf`/`*ngFor` or a `@for` without `track` ([`code.md`](../../conventions/code.md) §5);
  a single-statement `if`/`for` without braces (`curly: ['error','all']`) (§6).
- A TS `enum`, a bare repeated literal (`'fr'`, `'data-theme'`), or a cryptic identifier (`c`, `ch`,
  `i`) ([`code.md`](../../conventions/code.md) §7).
- `i18n.lang() === 'fr' ? … : …` to pick text → use `i18n.content()`
  ([`code.md`](../../conventions/code.md) §5, i18n text rule;
  [`architecture.md`](../../conventions/architecture.md) §5 for the bridge).
- A `:lang` route param or a non-static `redirectTo` → breaks native prerendering
  ([`architecture.md`](../../conventions/architecture.md), routing/SSG).
- Outward/sideways imports (`core → features`, `domain → anything`, feature → feature) or importing a
  folder's own barrel from inside it ([`architecture.md`](../../conventions/architecture.md) §2
  dependency rule, §3 barrels).
- Hardcoded `style="…"` or a hardcoded color/size in `.scss`
  ([`design.md`](../../conventions/design.md), tokens-only / when `[style.x]` is allowed).

## Verify before "done" (evidence over assertions)

From `client/` (or `make` at the root): `make lint` (ESLint + Stylelint) · `make test` / `make test-cov`
(Vitest; **100 % on `core/`**) · `make build` (`strictTemplates`) · `make e2e` (Playwright visual
regression — the net that guarantees a pixel-identical render). Run them; don't assert green. Details
and thresholds: [`testing.md`](../../conventions/testing.md).
