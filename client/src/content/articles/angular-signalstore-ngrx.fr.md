Cette application n'a qu'un seul store. Tout le reste de son état vit dans des `signal()` locaux,
au fond des composants qui les possèdent. Le store existe pour la seule donnée qui échappe à un
composant : la langue active et l'arbre de contenu qu'elle résout.

Cette donnée est lue partout (chaque titre, chaque libellé, chaque fil d'Ariane la consulte),
dérivée par les vues qui recalculent à partir d'elle, et mutée depuis deux endroits (le resolver
de route et le démarrage). C'est la fiche de poste d'un store. **NgRx SignalStore**
(`@ngrx/signals`) la remplit sans les actions ni les reducers du NgRx classique : des signals en
lecture seule en sortie, des méthodes en entrée.

## Composer des features

Un `signalStore` s'assemble à partir de features chaînées. `withState` déclare la forme et l'état
initial, `withComputed` les valeurs dérivées, `withMethods` les opérations. Chaque champ d'état
devient un signal exposé sur l'instance : déclarer `lang` produit `store.lang`, un `Signal<Lang>`
que n'importe quel composant peut lire.

Le store de contenu tient trois champs : `lang`, `content`, `loading`.

L'état ne se mute jamais directement. On passe par `patchState`, qui applique une mise à jour
immuable et ne notifie que les signals dont la valeur a changé. `loading` peut basculer sans rien
re-rendre qui dépende de `content`.

Ce store-là n'utilise pas `withComputed`. Ses valeurs dérivées (un titre de page, un fil
d'Ariane, une liste d'articles filtrée) sont propres à chaque écran, donc elles vivent dans les
composants qui les affichent, pas dans l'état partagé. La règle qui se dégage : ne centralise que
ce que plusieurs vues dérivent à l'identique.

## Construire l'état dans un contexte d'injection

`withState` accepte deux formes : un objet littéral, ou une fabrique qui le renvoie. La fabrique
s'exécute dans le contexte d'injection du store, ce qui l'autorise à `inject()` un service et à
lire `localStorage` au moment de la construction.

```typescript
export const ContentStore = signalStore(
  { providedIn: 'root' },
  withState<ContentState>(() => {
    const lang = readInitialLang();

    // Seed content synchronously so first paint + prerender already have the right locale.
    return { lang, content: inject(ContentApiService).peek(lang), loading: false };
  }),
  // withMethods / withHooks below
);
```

`readInitialLang` lit la préférence persistée, la valide comme `Lang`, et retombe sur la langue
par défaut si `localStorage` est absent ou lève une exception. Volontairement, aucun reniflage de
`navigator.language` : le prerender natif et les tests démarrent sur une langue déterministe,
jamais sur celle de la machine qui construit. C'est un choix qui se paie ailleurs (un premier
rendu SSG toujours en français) mais qui garde la génération statique reproductible.

## Stale-while-revalidate, concrètement

Le store affiche une valeur connue tout de suite, puis va vérifier derrière. Deux méthodes du
service de contenu portent ce contrat.

`peek(lang)` renvoie la valeur en cache de façon synchrone : c'est elle qui amorce l'état, pour
que le premier rendu et la génération statique aient déjà du contenu. `getContent(lang)` fait le
fetch asynchrone, le vrai appel réseau à terme.

Aujourd'hui ce service est un mock au-dessus du contenu embarqué dans le bundle. C'est le seul
point de couture entre l'app et « d'où vient le contenu » : le jour où une API .NET sert les
locales, c'est le seul fichier qui change.

```typescript
export const FETCH_DELAY_MS = 300;

public peek(lang: Lang): Content {
  return this.bundled[lang];
}

public getContent(lang: Lang): Promise<Content> {
  // Mock: a real client would fetch(this.contentUrl(lang)); we serve bundled content after a delay.
  return new Promise((resolve) => setTimeout(() => resolve(this.peek(lang)), FETCH_DELAY_MS));
}
```

Sur un changement de langue, `setLang` échange d'abord le contenu par `peek` (synchrone, donc le
prochain rendu est déjà dans la bonne locale), puis lance la revalidation. Le drapeau `loading`
passe à `true` le temps du fetch, ce qui laisse une vue afficher un état de chargement pendant la
bascule.

Le dictionnaire `bundled` est typé `Record<Lang, Content>`. Ajouter une langue au jeu de valeurs
`LANG` ne compile plus tant que son bundle n'est pas branché ici. Le compilateur tient la liste à
jour.

## Annuler un résultat périmé

Dès qu'une méthode est asynchrone, deux appels peuvent se chevaucher. Un visiteur passe en
anglais, puis en allemand avant que l'anglais soit revenu. Sans garde, le résultat anglais
arriverait en dernier et écraserait l'allemand.

`reload` se protège par un dernier-gagne : avant d'appliquer un résultat, il vérifie que la langue
courante est toujours celle qu'il a demandée.

```typescript
const reload = async (lang: Lang): Promise<void> => {
  patchState(store, { loading: true });
  const content = await api.getContent(lang);

  // Last-wins: a newer language switch has moved store.lang() on; drop this stale result.
  if (store.lang() === lang) {
    patchState(store, { content, loading: false });
  }
};
```

Un test verrouille ce comportement : il lance un `reload('en')` pendant que le store reste sur
`fr`, avance le temps simulé de `FETCH_DELAY_MS`, et vérifie que le contenu final est toujours
`FR`. Le résultat anglais est bien jeté.

## Un effet à l'intérieur du store

`withHooks` donne au store un cycle de vie. Son `onInit` s'exécute dans le contexte d'injection du
store, ce qui l'autorise à ouvrir un `effect`.

```typescript
withHooks({
  onInit(store) {
    const doc = inject(DOCUMENT);

    // Revalidate the seeded content once at startup.
    void store.reload(store.lang());

    // Persist the language and reflect it on <html lang="…"> reactively.
    effect(() => {
      const lang = store.lang();

      try {
        localStorage.setItem(STORAGE_KEYS.LANG, lang);
      } catch {
        /* localStorage unavailable */
      }
      doc.documentElement.setAttribute('lang', lang);
    });
  },
});
```

L'effet dépend de `store.lang()`. À chaque changement, il repersiste la préférence et met à jour
l'attribut `lang` de `<html>`, celui que lisent les lecteurs d'écran et les moteurs de recherche.
L'écriture `localStorage` est enveloppée dans un `try` qui avale l'erreur : un quota plein ne doit
pas casser le rendu. Un test le vérifie en faisant lever `setItem`, en s'assurant que le `tick` ne
jette pas, et que `<html lang>` passe quand même à jour.

Comme l'effet naît dans le contexte du store, il est nettoyé avec lui. Pas de `Subscription` à
défaire à la main.

## Une façade au-dessus du store

Aucun composant n'injecte `ContentStore` directement. Ils passent par `I18nService`, une façade
qui ne réexpose que quatre choses : `lang`, `content`, `loading`, `setLang`.

```typescript
@Injectable({ providedIn: 'root' })
export class I18nService {
  public readonly lang: Signal<Lang>;
  public readonly content: Signal<Content>;
  public readonly loading: Signal<boolean>;

  private readonly store = inject(ContentStore);

  constructor() {
    this.lang = this.store.lang;
    this.content = this.store.content;
    this.loading = this.store.loading;
  }

  public setLang(lang: Lang): void {
    this.store.setLang(lang);
  }
}
```

La surface est stable. Si le store gagne un champ interne ou change sa composition de features, les
dizaines de composants qui lisent la langue ne bougent pas. Ils dépendent d'un contrat, pas d'une
forme.

Le changement de langue se déclenche par l'URL, jamais par un appel direct. Le sélecteur de langue
navigue vers la même page avec un autre préfixe (`/fr`, `/en`, …). C'est le resolver de route qui
appelle `setLang` à partir de ce préfixe, avant que le composant ne rende. L'URL reste la seule
source de vérité pour la langue : un lien partagé vers `/de/articles` ouvre la page en allemand
sans qu'aucun état ne soit à synchroniser à la main.

## Le seuil du store

Tout n'a pas besoin d'un store, et cette app le montre en n'en ayant qu'un. Un onglet actif,
l'ouverture d'un menu : ça reste un `signal()` privé dans le composant. Y ajouter un store
n'apporterait que de l'indirection.

Le SignalStore se justifie quand l'état coche les cases que coche la langue ici : partagé entre
plusieurs écrans, dérivé par des vues qui recalculent à partir de lui, muté par des opérations
qu'on veut tester à part. Le dernier-gagne, la persistance, le seed synchrone se testent chacun en
isolation, sans monter un composant.

En pratique : commence avec des signals locaux, extrais un store le jour où tu copierais le même
état dans un deuxième composant. Le [guide SignalStore](https://ngrx.io/guide/signals/signal-store)
détaille chaque feature, `rxMethod` compris (que ce store n'utilise pas : un `async`/`await`
suffisait à orchestrer un unique fetch).

> Un SignalStore est une façade de signals : lecture seule en sortie, méthodes en entrée, zéro
> reducer. On garde la discipline d'un store, et son cycle de vie, sans le cérémonial des actions
> du NgRx d'hier.
