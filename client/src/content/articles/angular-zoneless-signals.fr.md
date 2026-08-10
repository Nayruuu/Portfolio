Cette application tourne sans zone.js. Pas derrière un flag expérimental : le paquet n'est
ni dans le `package.json`, ni dans `node_modules`, et `angular.json` déclare `"polyfills": []`. Le
change detection est piloté par les signals, et par eux seuls. Ce qui suit décrit comment c'est
câblé dans ce portfolio, et les quatre ou cinq endroits où l'absence de zone change vraiment la
façon d'écrire du code.

## Ce que zone.js faisait, et ce qui prend le relais

zone.js patchait toutes les API asynchrones du navigateur (`setTimeout`, les promesses, les
listeners DOM) pour prévenir Angular dès qu'un callback se terminait. À chaque notification, un
cycle de détection repartait de la racine et revérifiait l'arbre entier, y compris les composants
dont rien n'avait bougé.

En zoneless, ce monkey-patch disparaît. Un composant est marqué pour vérification quand un signal
qu'il lit dans son template notifie un changement. S'ajoutent quelques déclencheurs explicites :
un handler d'événement dans le template, un `markForCheck`, la mise à jour d'un `input()`.

La conséquence est directe. Un `setTimeout` qui réécrit un champ ordinaire ne provoque plus aucun
rafraîchissement. Avec zone.js, le tick global rattrapait ce genre de mutation sans qu'on y pense.
Sans lui, chaque source de changement doit passer par un signal, sinon la vue reste figée.

C'est un contrat plus strict, mais aussi plus lisible : la réactivité cesse d'être un effet de
bord de l'environnement d'exécution pour devenir une donnée du code.

## L'activation, un seul provider

Tout se joue dans `app.config.ts`. `provideZonelessChangeDetection()` remplace l'ancien
`provideZoneChangeDetection`, et le reste de la configuration accompagne ce choix.

```typescript
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
  ],
};
```

`withComponentInputBinding()` lie les paramètres de route aux `input()` des composants : le
`:slug` de la page article arrive directement dans un `input.required<string>()`, sans lecture
manuelle du snapshot. `provideClientHydration(withEventReplay())` rejoue les événements survenus
pendant l'hydratation, ce qui compte davantage sans zone : plus rien n'absorbe en arrière-plan un
clic arrivé avant que l'app soit interactive.

## La colonne vertébrale réactive

Toute l'app lit le contenu multilingue à travers un unique signal. `I18nService` est une façade
mince au-dessus d'un `SignalStore` [NgRx](https://ngrx.io/guide/signals) et n'expose que trois
signaux en lecture : `lang`, `content` et `loading`, typés `Signal<Lang>` / `Signal<Content>` /
`Signal<boolean>`. Les consommateurs ne dépendent jamais de la forme interne du store.

Le store suit une logique de stale-while-revalidate. Au démarrage, un `peek()` synchrone garnit le
contenu (premier rendu instantané, compatible avec le prerender statique), puis un `getContent()`
asynchrone le revalide. Un changement de langue est protégé par un last-wins : si une langue plus
récente a été demandée entre-temps, l'ancien résultat est ignoré.

L'effet de bord DOM vit dans un `withHooks` du store, à travers un `effect` qui réagit à `lang()` :
il persiste la préférence dans `localStorage` et reflète la valeur sur `<html lang="…">`. Personne
n'appelle ce code, il se réexécute quand le signal change.

L'intérêt se voit à l'usage. Changer de langue met à jour `content()`, et chaque `computed` ou
template qui le lit se recalcule sans un seul abonnement manuel.

## L'état dérivé se calcule tout seul

La page article illustre la chaîne au complet. Le paramètre de route est un `input`, tout le reste
en découle par `computed` :

```typescript
/** Route param `:slug`, bound via withComponentInputBinding. */
protected readonly slug = input.required<string>();

protected readonly article = computed<Article>(() => {
  const articles = this.i18n.content().articles;
  const index = articles.findIndex((a) => a.slug === this.slug());

  return articles[index] ?? articles[0];
});

protected readonly body = computed(() =>
  parseMarkdown(ARTICLE_BODIES[this.article().slug]?.[this.i18n.lang()] ?? ''),
);
```

`article` dépend de `slug()` et de `content()` ; `body` dépend de `article()` et de `lang()`.
Naviguer vers un autre article, ou basculer la langue, recompose l'ensemble sans code de
synchronisation. Les `computed` sont mémoïsés : `body` ne re-parse le Markdown que si le slug ou la
langue a réellement bougé.

Le même principe structure `PlayerService`, qui pilote le lecteur simulé de la page d'accueil. Le
temps de lecture (`time`) et l'état play/pause (`playing`) sont des signaux d'écriture. La liste
des chapitres dérive de la langue via `this.i18n.content().chapters`, le chapitre courant dérive du
temps, et le temps écoulé dans ce chapitre dérive des deux. Le template affiche `currentChapter()`
et suit automatiquement, sans `ngOnChanges` ni recalcul déclenché à la main.

Les entrées et sorties des composants sont, elles aussi, des signaux. Les scènes du lecteur
reçoivent leur horloge par `input.required<number>()` et leur état actif par
`input.required<boolean>()`, deux valeurs qui nourrissent directement des `computed`. La démo BSP
remonte ses événements au parent par `output<void>()`. Pour les états locaux vraiment triviaux, un
service peut se réduire à une ligne : la recherche du bandeau est un simple
`public readonly query = signal('')`, écrit par la barre de nav, lu par la grille d'articles.

Tous les composants de l'app sont en `ChangeDetectionStrategy.OnPush`. En zoneless c'est cohérent
de bout en bout : une vue n'est vérifiée que lorsqu'un signal qu'elle consomme le demande.

## Un intervalle piloté par un signal

Le point délicat du zoneless, c'est le code asynchrone impératif. `PlayerService` fait avancer une
horloge de lecture avec un `setInterval`, mais le `setInterval` vit à l'intérieur d'un `effect`
gouverné par le signal `playing`.

```typescript
constructor() {
  // Drive the tick loop reactively from `playing`.
  effect((onCleanup) => {
    if (!this.playing()) {
      return;
    }
    const intervalId = setInterval(() => {
      const next = this.time() + 0.1 * this.rate();

      this.time.set(next >= this.totalSec() ? 0 : next);
    }, 100);

    onCleanup(() => clearInterval(intervalId));
  });
}
```

Quand `playing` passe à `false`, l'effet se réexécute, `onCleanup` s'exécute avant et
`clearInterval` arrête la boucle. Le `rate()` lu dans le tick fait varier le pas sans reconstruire
quoi que ce soit.

Oublier ce `onCleanup` est le piège classique. L'intervalle survivrait à la pause, tournerait
plusieurs fois en parallèle après plusieurs bascules, et fuiterait dans les tests comme au
prerender SSR où le timer n'aurait jamais de raison de s'arrêter. Le `set()` sur `time` reste le
seul canal par lequel le tick informe la vue : sans zone.js, Angular ne se réveille que sur
l'écriture du signal, jamais sur le `setInterval` lui-même.

## Quand RxJS doit alimenter un signal

RxJS existe encore dans l'app, mais à la marge, et il ne pilote jamais un template directement. La
barre de votes doit recharger ses compteurs à chaque navigation entre articles : elle branche
`router.events` avec un `filter` sur `NavigationEnd` et un `takeUntilDestroyed()`, puis dans le
`subscribe` elle appelle un `load()` qui finit par un `this.tally.set(...)`.

Le flux sert de déclencheur, le signal porte l'état. `takeUntilDestroyed()` désabonne à la
destruction du composant sans `ngOnDestroy` manuel. L'API `toSignal()` ferait le même pont de façon
déclarative, mais ce portfolio n'en a pas eu besoin : ici, les rares streams se résument à un
`set()` dans le `subscribe`.

## La règle qui empêche la dérive

« Tout est un signal » est facile à dire et facile à trahir : il suffit d'un développeur qui écrit
`public loading = false` par réflexe. Une règle ESLint maison, `local/prefer-signal-primitives`,
garde la discipline.

Elle inspecte chaque champ public dont le type ou la valeur initiale est primitif (booléen,
chaîne, nombre, `bigint`, littéral, ou union de primitifs) et signale une erreur s'il n'est pas
initialisé avec `signal()`, `computed()`, `model()` ou `input()`. Le message est explicite :
`Public primitive field '{{name}}' should be a signal`. Elle est branchée en `error` sur tout
`src/app/**/*.ts`, les specs exclus.

L'effet est qu'un champ d'état exposé et laissé en primitif mutable ne compile plus au lint. La
convention ne dépend pas de la vigilance de chacun ; elle est vérifiée à chaque build.

## Tester quand il n'y a plus de zone

Sans zone.js, plus de `fakeAsync` ni de `tick()` : le projet n'en contient aucune occurrence. Deux
patterns le remplacent, décrits dans le [guide zoneless](https://angular.dev/guide/zoneless).

Pour un composant, on agit puis on attend la stabilité :
`await fixture.whenStable()` après une interaction, avant d'affirmer sur le DOM. Une vingtaine de
specs de composants suivent ce schéma.

Pour l'horloge de `PlayerService`, il faut piloter le change detection à la main. On force les
minuteurs de Vitest, on flushe l'effet avec `ApplicationRef.tick()` (ce qui programme le
`setInterval`), puis on avance le temps.

```typescript
it('the tick advances while playing, and onCleanup stops it on pause', () => {
  vi.useFakeTimers();
  const svc = TestBed.inject(PlayerService);
  const appRef = TestBed.inject(ApplicationRef);

  appRef.tick(); // flush the effect → schedules setInterval
  const before = svc.time();

  vi.advanceTimersByTime(100);
  expect(svc.time()).toBeCloseTo(before + 0.1, 5);

  svc.pause();
  appRef.tick(); // effect re-runs → onCleanup clears the interval
  const afterPause = svc.time();

  vi.advanceTimersByTime(1000);
  expect(svc.time()).toBe(afterPause);
});
```

Le test vérifie les deux moitiés du contrat : l'horloge avance de 0,1 par cent millisecondes en
lecture, et après `pause()` plus `appRef.tick()`, avancer d'une seconde entière ne bouge plus le
temps. `onCleanup` a bien coupé l'intervalle. C'est du zoneless qui se teste comme il tourne : les
changements sont explicites, on choisit quand ils se produisent.

> Le zoneless ne rend pas l'app plus rapide par magie. Ce qu'il change, c'est la traçabilité :
> chaque redessin remonte à un signal précis, et une règle de lint empêche l'état de s'échapper
> hors de ce modèle.
