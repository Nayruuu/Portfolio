Passer une app Angular en zoneless retire `zone.js`, et avec lui le signal implicite qui
prévenait « la vue est stable, tu peux inspecter le DOM ». Le contrat des tests change : au
lieu d'attendre qu'une zone se taise toute seule, chaque test réclame la stabilité au moment
précis où il en a besoin.

Ce portfolio tourne comme ça. 104 fichiers `.spec.ts`, plus de mille cas, aucun `fakeAsync`,
aucun `detectChanges()` manuel. Voici les patterns qui tiennent la suite, et les pièges qui
vont avec.

## Le mode zoneless, une fois pour toutes

Depuis Angular 21, le builder `@angular/build:unit-test` embarque **Vitest** : le runner et ses
options vivent dans `angular.json`, pas dans un `vitest.config.ts` à part. Une seule clé compte
pour la suite entière, `providersFile`, qui désigne les providers injectés dans l'environnement
de chaque test.

Ce fichier active le zoneless (`provideZonelessChangeDetection`) une bonne fois :

```typescript
// src/test-providers.ts: injected into every test's environment
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

export default [provideZonelessChangeDetection(), provideRouter([])];
```

Le `provideRouter([])` avec des routes vides évite de reconfigurer un routeur dans chaque
`beforeEach` : les composants qui utilisent `routerLink` se montent sans cérémonie, et la vraie
navigation reste couverte par les tests Playwright. Le
[guide de test Angular](https://angular.dev/guide/testing) part du même principe : monter le
composant réel, puis vérifier ce qu'il rend.

## Piloter un composant par ses inputs signal

Un `input()` signal est en lecture seule vu de l'extérieur. On ne réaffecte pas la propriété :
on passe par `fixture.componentRef.setInput()`, puis on attend que la valeur se propage jusqu'au
rendu avec `await fixture.whenStable()`.

```typescript
beforeEach(async () => {
  await TestBed.configureTestingModule({ imports: [CodeBlockComponent] }).compileComponents();
  fixture = TestBed.createComponent(CodeBlockComponent);
  fixture.componentRef.setInput('code', 'const answer = 42;');
  fixture.componentRef.setInput('lang', 'typescript');
});

it('renders the provided code', async () => {
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('answer');
});
```

Pas de `detectChanges()` : dans toute la suite, le compteur est à zéro. Le rendu se déclenche
parce que le composant réagit à ses signaux, et `whenStable()` rend la main quand la change
detection s'est posée.

Le composant `Typed` du player pousse le procédé plus loin. Sa sortie est une fonction pure de
trois inputs (`elapsed`, `at`, `text`) ; le test fixe les trois valeurs, attend la stabilité, et
vérifie le texte affiché lettre par lettre. À 40 caractères par seconde, `elapsed = 1.05` avec
`at = 1` donne exactement deux lettres visibles. La temporisation devient une assertion
déterministe, sans horloge à piéger.

## whenStable, et ce qu'il attend vraiment

`whenStable()` remplace `fakeAsync`/`tick()` pour l'asynchrone ordinaire, mais il faut savoir ce
qu'il attend : que l'application redevienne stable. Une tâche encore en vol la maintient
occupée, et la promesse ne se résout jamais.

Le cas concret vient de la page article. Sa barre de vote déclenche un `GET` sur l'API au
montage ; laissé tel quel, ce fetch pendant fait tourner `whenStable()` dans le vide. Le test
coupe la dépendance :

```typescript
// The like-bar fetches its tally on render; stub the API so the pending HTTP GET
// can't leave whenStable() hanging.
const feedback: Pick<FeedbackApiService, 'count' | 'cast'> = {
  count: () => Promise.resolve({ up: 0, down: 0, mine: null }),
  cast: () => Promise.resolve({ up: 0, down: 0, mine: null }),
};
```

Le stub renvoie des promesses déjà résolues : plus de requête en attente, `whenStable()` se
termine, et le décompte réel reste testé à son propre niveau dans `like-bar.component.spec.ts`.
La règle générale : tout ce qui garde l'app occupée (un timer, une requête, une microtâche)
doit être maîtrisé, sinon l'attente explicite se retourne contre le test.

## Les timers ne passent pas par la stabilité

Un `setInterval` n'est pas une tâche que `whenStable()` sait drainer : il tourne tant qu'on ne
l'arrête pas. Pour ces cas, on garde les faux timers de Vitest.

`PlayerService` en est l'exemple du repo. Sa boucle de lecture vit dans un `effect` qui lit le
signal `playing` : à l'activation, l'effet programme un `setInterval` qui avance le temps de
`0.1 × rate` toutes les 100 ms ; à l'arrêt, un `onCleanup` libère l'intervalle. C'est
exactement le genre de code où oublier le nettoyage laisse fuir un timer et fausse le test
suivant.

Le test doit d'abord déclencher l'effet, ce que fait `appRef.tick()`, puis avancer l'horloge
simulée. Il vérifie ensuite que la pause exécute bien le `onCleanup` :

```typescript
it('the tick advances time while playing, and onCleanup stops it on pause', () => {
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

`appRef.tick()` est le geste qui remplace l'ancien `detectChanges()` : il pousse Angular à faire
tourner ses effets. Le reste est du Vitest standard, `vi.advanceTimersByTime()` là où on écrivait
`tick()`, plus un `afterEach(() => vi.useRealTimers())` pour ne pas contaminer le cas d'après.

## La plupart des tests ne montent aucun composant

Sur les 104 fichiers de la suite, 73 n'importent même pas `TestBed`. Une fonction pure ou un
`computed()` s'appelle directement, sans fixture, sans DOM, sans attente : le test est immédiat.

`truncateAtWord`, qui coupe une bio à la dernière frontière de mot, se vérifie avec des entrées
et des sorties, rien d'autre :
`truncateAtWord('Full-stack developer building serious things', 20)` doit rendre
`'Full-stack developer'`, et un mot seul plus long que la limite se coupe net. On réserve
`TestBed` au rendu réel d'un template ; tout ce qui est logique se teste sans lui, et c'est la
majorité du code.

## Le garde-fou : core/ à 100 %

Les seuils globaux de couverture, dans `angular.json`, sont volontairement sous les 100 %
(statements 85, branches 78, functions 67, lines 88). Ils englobent les composants d'UI et le
hôte navigateur du jeu, son canvas et ses workers, qu'on ne cherche pas à couvrir ligne à
ligne ; ces fichiers sont d'ailleurs sortis du rapport via `coverageExclude`.

Le cœur logique, lui, doit rester intégral. Le builder ne sait pas imposer un seuil par dossier,
alors un petit script s'en charge après coup. `check-core-coverage.mjs` lit le résumé du
reporter `json-summary`, parcourt chaque fichier, et échoue (`exit 1`) dès qu'un fichier de
`core/` (hors `.spec.ts`) descend sous 100 % sur l'une des quatre métriques.

Comme les adaptateurs de rendu du jeu ne figurent pas dans le rapport, la règle des 100 %
s'applique pile à la logique pure qui reste. Le script de couverture enchaîne les deux étapes :
`ng test --coverage && node scripts/check-core-coverage.mjs`. Un fichier `core/` sous les 100 %
casse la commande, pas une ligne de log qu'on finit par ignorer.

> Sans `zone.js`, un test ne peut plus supposer que la vue est prête : il doit le demander.
> C'est un peu plus de code par cas, et en échange un test vert veut dire ce qu'il prétend dire,
> timers et requêtes compris.
