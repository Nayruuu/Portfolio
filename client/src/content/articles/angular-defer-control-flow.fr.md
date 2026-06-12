Le nouveau control flow d'Angular ne se contente pas de remplacer `*ngIf` et `*ngFor` par
une syntaxe plus jolie. Couplé à `@defer`, il change ce qui finit dans le bundle initial :
on n'expédie au démarrage que le JavaScript réellement nécessaire au premier rendu, le reste
arrive à la demande.

## @if, @for, @switch

La syntaxe `@` est intégrée au compilateur : pas d'import de directive, et un `track`
**obligatoire** sur `@for` qui force à réfléchir à l'identité des éléments. C'est ce `track`
qui évite de tout re-créer dans le DOM à chaque changement de liste.

```typescript
@if (user(); as currentUser) {
  <p>Bonjour {{ currentUser.name }}</p>
} @else {
  <p>Invité</p>
}

@for (item of items(); track item.id) {
  <li>{{ item.label }}</li>
} @empty {
  <li>Aucun élément</li>
}

@switch (status()) {
  @case ('loading') { <spinner /> }
  @case ('error') { <error-banner /> }
  @default { <content /> }
}
```

Le bloc `@empty` de `@for` et le `@case` exhaustif de `@switch` couvrent des cas qu'on
oubliait souvent avec les directives structurelles.

## @defer : charger plus tard

`@defer` enveloppe un bout de template dont le code est sorti du bundle principal et chargé
en **chunk séparé** au moment voulu. Le déclencheur décide quand : `on viewport` charge quand
le bloc entre dans l'écran, `on interaction` au premier clic/focus, `on idle` quand le
navigateur est inactif, `on hover`, ou `on timer`.

```typescript
@defer (on viewport) {
  <heavy-comments [postId]="postId()" />
} @placeholder (minimum 200ms) {
  <p>Commentaires</p>
} @loading (after 100ms; minimum 300ms) {
  <skeleton-list />
} @error {
  <p>Impossible de charger les commentaires.</p>
}
```

### Les blocs annexes

- `@placeholder` : rendu **avant** tout déclenchement, c'est lui qui peut porter le trigger
  `on viewport`/`on interaction`. Le `minimum` évite un flash trop bref.
- `@loading` : pendant la récupération du chunk ; `after` retarde son affichage pour ne pas
  clignoter sur une connexion rapide.
- `@error` : si le chunk ne charge pas (réseau coupé, par exemple).

On peut aussi pré-charger sans afficher avec `prefetch on hover`, pour que le clic soit
instantané sans alourdir le démarrage.

## L'impact sur le bundle

Tout composant, directive ou pipe utilisé **uniquement** dans un bloc `@defer` est extrait
dans son propre chunk. Une page lourde — éditeur de code, graphiques, carte — peut ainsi
sortir 100 à 200 ko du bundle initial, qui ne se téléchargent que si l'utilisateur scrolle
jusque-là. Le gain se mesure directement sur le **Largest Contentful Paint** et le temps
d'interactivité. La doc détaille chaque déclencheur dans le
[guide du chargement différé](https://angular.dev/guide/templates/defer).

Attention toutefois : un `@defer (on viewport)` placé au-dessus de la ligne de flottaison se
déclenche immédiatement et n'apporte rien. Le différé n'a de sens que pour ce qui est
**hors écran** ou conditionnel.

> Le control flow rend l'intention lisible, `@defer` rend le coût explicite. Plutôt que de
> tout charger « au cas où », tu déclares quand chaque morceau mérite son JavaScript — et le
> démarrage s'allège tout seul.
