Angular 21 embarque son control flow dans le compilateur : `@if`, `@for`, `@switch`, plus `@let` et
`@defer`. Ce portfolio s'en sert partout, au point qu'aucun composant n'importe plus `CommonModule`,
`NgIf` ni `NgForOf`.

Le « moins de JS au démarrage » du titre recouvre deux leviers séparés : le découpage par route, et
un `@defer` posé sur le seul gros bloc que la page d'accueil transportait sans jamais l'exécuter. Ce
second levier retire environ 260 ko de JavaScript brut du chargement de la home, mesuré sur le build
de production. Je prends les deux sujets à part, parce qu'ils ne règlent pas le même problème.

## Le control flow vit dans le compilateur

`@if` et `@for` ne sont pas des directives : le compilateur de templates les reconnaît directement.
Un composant qui affiche une liste conditionnelle n'a rien à déclarer dans son tableau `imports`. Un
`grep` sur `CommonModule`, `NgIf`, `NgForOf` ou `NgSwitch` dans `client/src/app` ne remonte rien :
ces symboles ont quitté le code applicatif.

L'autre nouveauté discrète, c'est `@let`. Presque tous les templates du projet commencent par la
même ligne, `@let content = i18n.content();` : une variable locale au template, en lecture seule,
réévaluée quand le signal change. Elle évite de répéter `i18n.content()` à chaque interpolation et
sert de point d'entrée unique vers le contenu traduit de la locale courante.

## `@if`, `@else if`, `@else`

Le lecteur vidéo de la page d'accueil est un branchement à trois voies. Selon l'état, il rend le
bouton de restauration du mode mini, le jeu, ou la scène par défaut :

```html
@if (player.mini()) {
  <button class="player__popped" (click)="player.closeMini()">…</button>
} @else if (game.running()) {
  <sd-bsp-demo (exited)="exitGame()" [fullscreen]="fullscreen()" />
} @else {
  <sd-player-stage />
  <!-- controls, progress bar, settings… -->
}
```

La condition prend un signal appelé comme une fonction (`player.mini()`, `game.running()`). Le `@if`
accepte aussi un alias qui capture la valeur non nulle pour la suite du bloc. La page projet l'emploie
ainsi, `@if (articleSlug(); as slug)`, pour ne travailler que sur un identifiant garanti présent.

## `@for` et le `track` obligatoire

`@for` impose une expression `track`. Elle dit à Angular comment identifier un élément d'un rendu à
l'autre, donc quels nœuds du DOM réutiliser au lieu de tout recréer. Le compilateur refuse un `@for`
qui n'en a pas.

Dans ce repo, trois choix de clé reviennent, selon la nature des données.

Quand l'élément porte un identifiant stable, on suit cet identifiant :
`track chapter.id` pour les chapitres du lecteur, `track review.who` pour les avis, `track tech.name`
pour les technologies d'un niveau de stack. Deux rendus successifs y retrouvent le même objet même si
sa position bouge.

Quand la liste est faite de chaînes ou de nombres, on suit la valeur elle-même : `track tech` sur les
tags d'un projet, `track lang` sur les langues, `track speed` sur les vitesses de lecture. La valeur
tient lieu de clé.

Reste `track $index`, pour les listes positionnelles qui ne se réordonnent jamais. Le corps d'un
article rendu depuis son Markdown en est l'exemple : les blocs analysés gardent leur ordre, l'index
est donc une clé légitime.

```html
@for (block of body(); track $index) {
  @switch (block.type) {
    @case ('h2') { <h2><sd-inline-runs [runs]="block.runs" /></h2> }
    @case ('p') { <p><sd-inline-runs [runs]="block.runs" /></p> }
    @case ('ul') {
      <ul>
        @for (item of block.items; track $index) {
          <li><sd-inline-runs [runs]="item" /></li>
        }
      </ul>
    }
    @case ('code') { <sd-code-block [code]="block.text" [lang]="block.lang" /> }
    @case ('quote') { <blockquote><sd-inline-runs [runs]="block.runs" /></blockquote> }
  }
}
```

`@for` sait aussi exposer `$index` sous un nom : `@for (filter of content.articleFilters; track
filter; let index = $index)` garde l'index sous la main pour marquer le filtre actif. Le bloc
`@empty`, lui, n'apparaît nulle part dans le projet. Le cas « liste vide » est traité par un `@if`
séparé placé avant la grille, `@if (filtered().length === 0)`, parce que le message d'absence de
résultat vit ailleurs dans la mise en page que la grille elle-même.

## `@switch` pour rendre le Markdown

L'extrait ci-dessus montre le vrai usage de `@switch` dans le projet : projeter un arbre de blocs
Markdown vers les bons éléments. `@switch (block.type)` aiguille chaque nœud (`h2`, `p`, `ul`,
`code`, `quote`) vers son composant de rendu. Un second `@switch (run.kind)` fait le même travail un
cran plus bas, dans `sd-inline-runs`, pour distinguer texte, lien et code inline à l'intérieur d'un
paragraphe.

C'est du contenu, pas de l'UI d'application : chaque `@case` correspond à une variante fermée du
modèle de données, et le compilateur vérifie les templates de chaque branche.

## Ce que « moins de JS au démarrage » veut dire ici

Le control flow rend les templates lisibles, mais il ne réduit pas à lui seul le JavaScript
téléchargé au premier chargement. Ce travail-là passe par deux mécanismes : le routeur, et un
`@defer`.

Chaque feature est chargée à la demande. `app.routes.ts` déclare quatorze points de `loadComponent`
ou `loadChildren` ; les pages `articles`, `series` et `projects` ont même leur propre sous-arbre de
routes lazy :

```typescript
{
  path: 'articles',
  loadChildren: () =>
    import('./features/articles/articles.routes').then((m) => m.ARTICLES_ROUTES),
},
```

Le `import()` dynamique est ce que le bundler suit pour créer un chunk séparé. Tant qu'un visiteur ne
va pas sur `/articles`, le code de cette page ne part pas sur le réseau. Le premier chargement ne
transporte que la route affichée.

`@defer` déplace cette même idée sous la route, à l'intérieur d'un template. Il enveloppe un fragment
dont le code sort du chunk courant et n'arrive qu'au déclencheur choisi : `on viewport`,
`on interaction`, `on idle`, `on hover`, `on immediate` ou `on timer`. Il vient avec ses blocs
auxiliaires, décrits dans le [guide du chargement différé](https://angular.dev/guide/templates/defer) :

```html
@defer (on interaction) {
  <heavy-widget />
} @placeholder {
  <p>…</p>
} @loading (after 100ms; minimum 300ms) {
  <skeleton />
} @error {
  <p>Chargement impossible.</p>
}
```

Le `@placeholder` est rendu avant tout déclenchement et peut porter le trigger. Le `@loading` couvre
le temps de récupération du chunk, avec un `after` qui retarde son affichage pour ne pas clignoter
sur une connexion rapide. Le `@error` prend le relais si le chunk ne charge pas.

## Le `@defer` posé sur le moteur de jeu

Le composant du jeu, `sd-bsp-demo`, tire tout le moteur derrière lui : `asset-loader`,
`combat-runtime`, `pickup-runtime`, les painters, l'IA des ennemis. Le build en fait un chunk à part,
`bsp-demo-component`, de 261 ko bruts, 69 ko une fois compressé en gzip.

Ce code ne sert qu'après un clic sur la manette du lecteur, et la quasi-totalité des visiteurs ne le
déclenche jamais. Le `@if (game.running())` ne conditionnait que le **rendu** : le moteur, lui,
partait dans le chunk de la home et restait là, chargé pour rien.

Le bloc est maintenant enveloppé dans un `@defer`, à l'intérieur de la branche déjà gardée par la
condition :

```html
@else if (game.running()) {
  @defer (on immediate) {
    <sd-bsp-demo
      (exited)="exitGame()"
      [fullscreen]="fullscreen()"
      [fullscreenAvailable]="nativeFullscreen"
      (fullscreenToggle)="toggleFullscreen()"
    />
  }
}
```

Le déclencheur `on immediate` charge le chunk dès que le bloc entre dans le DOM. Comme ce bloc vit
sous `@else if (game.running())`, il n'entre dans le DOM qu'une fois le jeu lancé : la condition fait
déjà le tri, `on immediate` ne fait que tirer le code au moment précis où la branche s'affiche. Tant
que le jeu ne tourne pas, c'est la branche `@else` qui est rendue, soit le lecteur normal ; il n'y a
donc rien à mettre dans un `@placeholder`, et l'affichage ne change pas.

`BspDemoComponent` reste dans le tableau `imports` du lecteur. Angular diffère automatiquement un
composant standalone dont le seul point d'usage est à l'intérieur d'un `@defer` : pas besoin d'un
`import()` dynamique à la main ni de retirer la déclaration.

Le résultat se lit sur le build de production. En chargeant `/fr` et en relevant le resource-timing
(`performance.getEntriesByType('resource')`), le JavaScript de la home passe de 774 534 à 514 771
octets bruts, et de douze à onze fichiers. C'est 259 763 octets en moins, environ −260 ko bruts,
près de 33 % du JS de la page d'accueil ; sur le réseau, le chunk retiré pèse 69 ko une fois
compressé. La mesure est ponctuelle, prise une fois sur un build réel, pas un banc d'essai moyenné.

La distinction tient toujours. Le control flow décide de ce qui s'affiche ; le découpage par route et
`@defer` décident de ce qui se télécharge. Le projet applique le premier partout, le second aux
routes, et désormais à ce bloc précis.

> Le nouveau control flow a aplati les templates et sorti `CommonModule` du code. Alléger le
> démarrage reste un travail distinct : il passe par le routeur, et par un `@defer` sur le moteur du
> jeu, qui retire un tiers du JavaScript de la page d'accueil pour ne l'envoyer qu'au visiteur qui
> lance la partie.
