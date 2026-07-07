# Code conventions — TypeScript / Angular

> **Canonical rulebook for application TS/Angular code.** `CLAUDE.md`, the `angular-rules`
> skill, and the agents *reference* this file — they never restate its rules. Each rule lives
> here once. Source of truth: `client/eslint.config.mjs` + `client/eslint-rules/` + the code itself.
> When this doc and the code disagree, the code wins — fix the doc.

Stack baseline: **Angular 21** (standalone, **zoneless**, signals), **TypeScript 5.9**
(`strict`, `strictTemplates`, `noImplicitOverride`, `strictInputAccessModifiers`),
**angular-eslint 21** + **typescript-eslint 8**, Prettier as the sole formatter.
Selector prefix is **`sd-`** (components: `kebab-case` element; directives: `camelCase`
attribute). Layout/encapsulation/import-boundary rules and the typed `Content` bridge / FR-EN
contract live in [`architecture.md`](architecture.md); SCSS rules in [`design.md`](design.md). This
file is *code shape* plus the **i18n text rule** (displayed text comes from the typed `Content`
bridge, never a `lang()` ternary — §5).

ESLint config shape (so rules land on the right files):

- `**/*.ts` → `eslint.recommended` + `tseslint.recommended` + `angular.tsRecommended`, plus the
  custom rules below; `angular.processInlineTemplates` is the processor.
- `src/app/**/*.ts` **excluding `**/*.spec.ts`** → the `local` plugin (`prefer-signal-primitives`).
- `**/*.html` → `angular.templateRecommended` (+ `@angular-eslint/template/eqeqeq`
  `{ allowNullOrUndefined: true }`).
- `eslint-config-prettier` is applied **last but one**; a trailing `**/*.ts` block re-enables
  `curly` *after* it (see below).
- Not linted: `dist`, `node_modules`, `.angular`, `coverage`, `e2e/__screenshots__`,
  `scripts/**`, `eslint-rules/**`.

---

## 1. Component & service shape

| Rule | How | Enforced by |
| --- | --- | --- |
| **Standalone only** — never `NgModule` | every component/directive/pipe is standalone (the Angular 21 default; no `standalone: true` needed, no `declarations`) | convention (the app has zero `NgModule`s) |
| **`ChangeDetectionStrategy.OnPush`** on every component | `changeDetection: ChangeDetectionStrategy.OnPush` in `@Component` | convention |
| **Zoneless** | `provideZonelessChangeDetection()` in `app.config.ts`; no `zone.js` | convention |
| **Separate templates** — never inline | each component has its own `.component.html` via `templateUrl` | `@angular-eslint/component-max-inline-declarations` → `{ template: 0 }` |
| **Separate styles** — never inline | each component has its own `.component.scss` via `styleUrl`; **no `styles`/`styleUrls` array, no inline `template`, no `animations`** | `@angular-eslint/component-max-inline-declarations` → `{ template: 0, styles: 0, animations: 0 }` |
| **`inject()`** — never constructor DI | `private readonly x = inject(X)`; the constructor is used only for `effect()`/init side-effects, never for injecting params | convention (zero `constructor(private …)` in the app) |
| Selector prefix | `sd-` | `@angular-eslint/component-selector` `{ type: 'element', prefix: 'sd', style: 'kebab-case' }` · `@angular-eslint/directive-selector` `{ type: 'attribute', prefix: 'sd', style: 'camelCase' }` |

### `@Component` property order

Fixed order in the decorator object: **`selector` → `host` → `styleUrl` → `templateUrl` →
`changeDetection` → `imports` (last)**. `host`/`styleUrl` are present only when needed; `imports`
is Prettier-formatted (inline when short, one-per-line when long). Not ESLint-enforced — a
house convention, applied uniformly.

```ts
@Component({
  selector: 'sd-contact',
  host: { class: 'tab-pane' },
  styleUrl: './contact.component.scss',
  templateUrl: './contact.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
})
export class ContactComponent { … }
```

Services use `@Injectable({ providedIn: 'root' })` and the same `inject()`/signal rules.

### Size & single responsibility

Small, focused units. These keep a file readable at a glance and stop the god-class/god-component
drift a large feature accretes. **Held by review today** — no `max-lines-per-function` ESLint rule is
wired yet (the game code is mid-decomposition and still has offenders); once that lands, the ≤ 50-line
rule should be promoted to `@typescript-eslint`/`max-lines-per-function` in `client/eslint.config.mjs`
and this note updated.

- **A function is ≤ 50 lines** — a **hard rule**. Past that, extract: name the sub-steps as helpers, or
  the function is doing more than one thing. (Applies to every function/method, including the render
  loop and AI steppers — the long ones get decomposed, not exempted.)
- **One file = one responsibility** — a **hard rule**, the sharper form of the project's
  one-declaration-per-file convention (→ `architecture.md`). A class/module does one job; if you can
  only describe it with "and", it's two files.
- **~5 methods per class is a smell trigger, not a cap.** Above roughly five methods, ask "is this two
  responsibilities?" and split *only if the answer is yes*. Do **not** shatter a cohesive
  single-responsibility class into atomic files to hit a number — artificial fragmentation hurts
  readability as much as a god-class does. The responsibility rule governs; the count only prompts the
  question.
- **UI-less logic lives in `core`, not the component.** A feature component is a thin shell (canvas /
  rAF / DOM / input wiring, template state). Its pure logic (game rules, AI, geometry, zone/state
  math) belongs in `core/lib` (pure, 100 %-tested) or a `core/services` service — extracted and
  unit-tested, not inlined. Refactor **test-first**: characterise the behaviour with unit tests on the
  extracted pure unit, then move it; the component shell stays under the Playwright visual net.

---

## 2. Signals for all state

State is **signals only** — `signal()`, `computed()`, `effect()`; no `BehaviorSubject`/
observable-store for component or service state. RxJS is present but barely used.

- **Reads** come from `computed()`; never duplicate derived state into a plain field.
- **`effect()` side-effects** that own a timer/subscription **must `onCleanup`** — e.g.
  `PlayerService` runs a 100 ms `setInterval` inside an `effect` and clears it via the
  `onCleanup` callback (a known gotcha — leaking it breaks tests and SSR).
- Signal services that expose a stable surface use a **facade** (`I18nService` over
  `ContentStore`) and the content store is an **NgRx SignalStore** — see
  [`architecture.md`](architecture.md) for the state-layer rules; this file only covers the *shape*
  (signals, accessibility, ordering).

### `local/prefer-signal-primitives` (custom rule — `client/eslint-rules/`)

Pushes **public primitive fields toward signals.** It reports a `PropertyDefinition` when **all**
hold:

- accessibility is **public** (explicit `public` *or* no modifier; `protected`/`private`/`#private`
  fields are **exempt**),
- it is **not `static`**,
- its **declared type** is a primitive (`boolean`/`string`/`number`/`bigint`/`symbol`/`null`/
  `undefined`, a primitive **literal type**, or a **union of those**) **or** its **initializer** is
  a primitive literal (`string`/`number`/`boolean`/`bigint`),
- and the initializer is **not** a signal factory call — `signal()`, `computed()`, `model()`,
  `input()` (bare or member form like `input.required()`).

So a public primitive field **must** be a signal; a non-signal primitive stays legal only when
`protected`/`private` (e.g. `protected name = ''` in `ContactComponent`, a two-way-bound form field).
Fix by wrapping the value: `public readonly liked = signal(false)`.

> Scope: the `local` plugin block globs `src/app/**/*.ts` and **ignores `**/*.spec.ts`** — so the
> rule covers **component/service code** (the classes that hold public primitive fields). The root
> wiring files (`app.config.ts`, `app.routes.ts`, `app.routes.server.ts`, `app.config.server.ts`)
> are inside the glob but declare **no public primitive class fields** — they export route arrays /
> provider config, not stateful classes — so the rule has nothing to flag there. Tests are exempt.

---

## 3. Inputs / outputs / queries — signal-based only

Never the legacy decorators `@Input()` / `@Output()` / `@ViewChild()` / `@ViewChildren()` /
`@ContentChild()`. Use the signal forms:

| Need | Use |
| --- | --- |
| Optional input | `input<T>(default?)` |
| Required input | `input.required<T>()` |
| Two-way | `model<T>()` |
| Output | `output<T>()` |
| Element/component query | `viewChild<T>('ref')` / `viewChild.required<T>()`, `contentChild()` |

`input()`/`computed()`/`model()` are also recognised as signal initializers by
`prefer-signal-primitives`, so a `public readonly data = input.required<Comment>()` satisfies the
rule.

```ts
export class CommentItemComponent {
  public readonly data = input.required<Comment>();          // bound by parent → public

  protected readonly i18n = inject(I18nService);               // template-used → protected
  protected readonly liked = signal(false);
  protected readonly handle = computed(() => this.data().who.replace(/\s/g, '').toLowerCase());
}
```

Route params bind to detail-component inputs via `withComponentInputBinding()` (see routing). A
`viewChild` ref reads its element as `this.progressEl()?.nativeElement` and is typed
`viewChild<ElementRef<HTMLDivElement>>('progress')`.

---

## 4. Member accessibility & ordering

### Explicit accessibility on every member

Every class member carries an **explicit** modifier. Choose by audience:

- **`public`** — bound by a parent (`input()`/`output()`/`model()`) or part of a service's API.
- **`protected`** — used by the component's own template (so the template can read it but nothing
  external can).
- **`private`** (or `#private`) — internal only, never the template, never a parent.

Constructors take **no** modifier.

> ESLint: `@typescript-eslint/explicit-member-accessibility` →
> `{ accessibility: 'explicit', overrides: { constructors: 'no-public' } }`.

### Member order

> ESLint: `@typescript-eslint/member-ordering` with this `default` group order:

1. decorated fields: `public` → `protected` → `private`
2. plain fields: `public-static` → `public-instance` → `protected-static` →
   `protected-instance` → `private-static` → `private-instance`
3. `constructor`
4. methods, same accessibility/static order as fields:
   `public-static-method` → `public-instance-method` → `protected-static-method` →
   `protected-instance-method` → `private-static-method` → `private-instance-method`

In practice: **public fields → protected fields → private fields → constructor → methods**
(`PlayerService` and `PlayerComponent` are the canonical layouts). The constructor sits between
fields and methods, so an `effect()` wired in the constructor still comes after all field
declarations.

---

## 5. Native control flow & template basics

Templates use **native control flow only** — `@if` / `@for` / `@switch` / `@let`; never
`*ngIf` / `*ngFor` / `*ngSwitch` / `NgIf` / `NgForOf`. **Every `@for` declares `track`.**

`@angular-eslint/templateRecommended` is the baseline (it flags missing `track`, deprecated
two-way patterns, etc.); the one project override is
`@angular-eslint/template/eqeqeq` → `{ allowNullOrUndefined: true }` (use `===`/`!==`, but
`== null`/`!= null` nullish checks are allowed). The `[style.x]`-only-for-dynamic-values rule lives
in [`design.md`](design.md).

### Displayed text comes from the typed `Content` bridge — never a `lang()` ternary

**Every displayed string is read through `i18n.content()`** (the active-language `Content`, typed
across all locales) — never selected with a language ternary. Both of these are banned:

```html
<!-- ✗ bypasses the typed bridge; breaks cross-locale alignment -->
{{ i18n.lang() === 'fr' ? 'Accueil' : 'Home' }}
```
```ts
// ✗ same defect in TS
const label = this.i18n.lang() === LANG.FR ? 'Accueil' : 'Home';
```
```html
<!-- ✓ text comes from content.<lang>.json via the typed Content surface -->
{{ i18n.content().nav.home }}
```

A `lang()==='fr' ? … : …` ternary that picks **text** sidesteps `content.<lang>.json` and the
`Content` contract, so a string added in one language silently has no counterpart in the others —
exactly what the cross-locale alignment check exists to prevent. Add the string to the **FR source**
JSON (then `make i18n` regenerates the other locales) and read it from `i18n.content()`.

Using `i18n.lang()` for **routing** is fine — that's a URL value, not text: prefixing a `routerLink`
with `i18n.lang()` (`[routerLink]="['/', i18n.lang(), 'articles']"`) is the documented pattern. The
bridge mechanics (`satisfies JsonContent as Content`), the multilingual `Content` contract, and the
`I18nService` facade that exposes `content()` are owned by [`architecture.md`](architecture.md).

---

## 6. Statement & formatting rules (ESLint, beyond Prettier)

Prettier owns whitespace/quotes/line-wrap (2-space TS/HTML; SCSS uses tabs — see
[`design.md`](design.md)). These ESLint rules add *semantic* shape Prettier doesn't:

| Rule | Effect |
| --- | --- |
| `curly: ['error', 'all']` | braces on **every** `if`/`else`/`for`/`while`, even single-statement. Re-enabled in a trailing `**/*.ts` block **after** `eslint-config-prettier` (which disables `curly` defensively); safe because `curly:all` only *adds* braces and Prettier never removes them. |
| `newline-before-return` | a blank line before every `return` (unless it's the first statement in its block). |
| `padding-line-between-statements` | a **blank line after** a run of declarations (`const`/`let`/`var` → `*` = `always`), but **not** required *between* consecutive declarations (`always` then `any` for decl→decl). |

Relaxed from the recommended presets (intentional):
`@typescript-eslint/no-unused-expressions`, `@typescript-eslint/no-empty-object-type`,
`@typescript-eslint/no-inferrable-types`, `@typescript-eslint/no-namespace`, and
`no-empty-pattern` are **off**.

---

## 7. Types — no enum, derived unions, explicit names

### Never a TypeScript `enum`

`enum` is banned (runtime emit + friction with bundlers / `outputMode: 'static'`). A finite
domain is a **string-literal union**. When the values are also needed at runtime, **derive the
union from an `as const` object/array** so there's a single source:

```ts
// value set → derived type, single source of truth
export const LANG = { FR: 'fr', EN: 'en', ES: 'es', DE: 'de' } as const;
export type Lang = (typeof LANG)[keyof typeof LANG];

export const ARTICLE_TAGS = ['.NET', 'ANGULAR', 'AZURE', 'FLUTTER', 'DEVOPS', 'TUTO'] as const;
export type ArticleTag = (typeof ARTICLE_TAGS)[number];
```

Prefer a **closed union** to bare `string` for any finite field, but **use the `as const`
derivation ONLY when the values are also needed at runtime** — that is exactly three: `LANG`,
`THEME` (object form, above) and `ARTICLE_TAGS` (array form, above). For a finite field whose
values are **type-only** (never iterated or looked up at runtime), write a **plain string-literal
union** in its own file — *no* `as const` object:

```ts
export type CodeLang = 'csharp' | 'typescript' | 'yaml' | 'dart' | 'bash';
export type ContactKind = 'mail' | 'linkedin' | 'github' | 'cal';
export type SceneId = 'intro' | 'stack' | 'projects' | 'timeline' | 'outro';
```

Repeated literal values/keys go through **named constants** (`LANG`, `THEME`, `STORAGE_KEYS`,
`DATA_THEME_ATTR`) — never a bare `'fr'`/`'data-theme'`/`'super-dev-lang'` at a call site.
Exception: **object keys of a `Record<Lang, …>`** may stay literal (the compiler checks them).

Exhaustive `switch` over a closed union ends with a `default: kind satisfies never;` guard so a
new variant fails to compile (see `ContactComponent.iconOf`).

> The typed-content `satisfies … as Content` bridge that recovers these unions after JSON import,
> the multilingual `Content` contract, and one-declaration-per-file / barrel rules are all in
> [`architecture.md`](architecture.md).

### Explicit, non-abbreviated naming — every identifier

No cryptic 1–2-char names anywhere. This covers **content-model fields**, **local variables**,
**function/arrow parameters**, and template `@let`/`@for` variables:

- model fields: `label` not `lbl`, `subtitle` not `sub`, `accentColor` not `accent`,
  `timestamp` not `ts`.
- identifiers: `content` not `c`, `chapter` not `ch`, `article` not `a`, `index` not `i`,
  `event` not `e`.

Only **string *values*** that happen to be short stay — token-kind syntax-highlight classes
(`'c'`, `'s'`) and the locale literals `'fr'`/`'en'` are values, not identifiers. Not
ESLint-enforced; held by review and the existing code as the reference.

**One exception — standard mathematical notation.** In geometry/rendering math the conventional short
names ARE the domain vocabulary and are allowed: `dx`/`dy` (deltas), `nx`/`ny` (normals), `px`/`py`
(pixel/point coords), `a`/`b` (segment vertices), `p`/`q` (a local point/record pair), `x`/`y`/`z` (coordinate
axes / tight pixel-grid loops), `t` (a ray/segment parameter), `n`/`nz` (grid dimensions). Two
guards stop this from becoming a licence for cryptic code:

1. **It must read as genuine notation** — a mathematician could say what each symbol holds. A generic
   loop or bookkeeping index that ISN'T notation gets spelled out (`neighborIndex`, `scanX`,
   `sampleCount`, …), never a random opaque letter.
2. **Terse symbols are defined in a comment above the method.** When a method leans on several math
   short-names, a one-line doc comment over it names them — e.g.
   `// p, q = segment ends; t = param along it (0..1); nx, ny = inward normal` — so the body stays
   dense-but-readable without inflating every identifier.

---

## Quick checklist (before calling a component/service done)

- [ ] standalone, `OnPush`, `inject()` (no constructor DI), `sd-` selector
- [ ] separate `.html` + `.scss` (no inline `template`/`styles`/`animations`)
- [ ] `@Component` order: `selector` → `host` → `styleUrl` → `templateUrl` → `changeDetection` → `imports`
- [ ] all state via `signal`/`computed`/`effect`; `effect` timers `onCleanup`
- [ ] **public** primitive fields are signals (`prefer-signal-primitives`)
- [ ] `input()`/`input.required()`/`output()`/`model()`/`viewChild()` — no legacy decorators
- [ ] explicit `public`/`protected`/`private` per audience; member order: public→protected→private fields → ctor → methods
- [ ] native control flow; every `@for` has `track`; `===`/`!==` (or `== null`)
- [ ] displayed text via `i18n.content()` — **no `lang()==='fr' ? … : …` text ternary** (§5)
- [ ] braces on all blocks; blank line before `return`; blank line after declaration runs
- [ ] no `enum`; closed unions / `as const`-derived; named constants; explicit non-abbreviated identifiers
- [ ] functions ≤ 50 lines; one file = one responsibility; UI-less logic in `core/lib` (test-first)
- [ ] `make lint` clean
