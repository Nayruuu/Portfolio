Angular 21 integriert seinen Control Flow direkt in den Compiler: `@if`, `@for`, `@switch`, dazu `@let` und
`@defer`. Dieses Portfolio nutzt ihn überall, sodass keine Komponente mehr `CommonModule`,
`NgIf` oder `NgForOf` importiert.

Das „weniger JS beim Start" aus dem Titel deckt zwei getrennte Hebel ab: die Aufteilung nach Route, und
ein `@defer` auf dem einzigen großen Block, den die Startseite transportierte, ohne ihn je auszuführen. Dieser
zweite Hebel entfernt rund 260 kB rohes JavaScript aus dem Laden der Home, gemessen am Production-Build.
Ich behandle beide Themen getrennt, weil sie nicht dasselbe Problem lösen.

## Der Control Flow lebt im Compiler

`@if` und `@for` sind keine Direktiven: Der Template-Compiler erkennt sie direkt.
Eine Komponente, die eine bedingte Liste anzeigt, muss nichts in ihrem `imports`-Array deklarieren. Ein
`grep` nach `CommonModule`, `NgIf`, `NgForOf` oder `NgSwitch` in `client/src/app` findet nichts:
diese Symbole haben den Anwendungscode verlassen.

Die andere, unauffällige Neuerung ist `@let`. Fast alle Templates des Projekts beginnen mit derselben
Zeile, `@let content = i18n.content();`: eine lokale Template-Variable, nur lesbar,
die bei jeder Änderung des Signals neu ausgewertet wird. Sie erspart das wiederholte `i18n.content()` bei jeder Interpolation und
dient als einheitlicher Einstiegspunkt zum übersetzten Inhalt der aktuellen Locale.

## `@if`, `@else if`, `@else`

Der Videoplayer der Startseite ist eine Drei-Wege-Verzweigung. Je nach Zustand rendert er den
Button zur Wiederherstellung des Mini-Modus, das Spiel oder die Standardszene:

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

Die Bedingung nimmt ein Signal, das wie eine Funktion aufgerufen wird (`player.mini()`, `game.running()`). Das `@if`
akzeptiert auch einen Alias, der den nicht-null-Wert für den weiteren Block einfängt. Die Projektseite nutzt es
so, `@if (articleSlug(); as slug)`, um nur mit einer garantiert vorhandenen ID zu arbeiten.

## `@for` und das obligatorische `track`

`@for` erfordert einen `track`-Ausdruck. Er sagt Angular, wie ein Element von einem Render zum
nächsten identifiziert wird, also welche DOM-Knoten wiederverwendet statt komplett neu erstellt werden. Der Compiler verweigert ein `@for`
ohne diesen Ausdruck.

In diesem Repo kommen je nach Art der Daten drei Auswahlmöglichkeiten für den Schlüssel wieder.

Wenn das Element eine stabile ID trägt, folgt man dieser ID:
`track chapter.id` für die Kapitel des Players, `track review.who` für die Bewertungen, `track tech.name`
für die Technologien einer Stack-Ebene. Zwei aufeinanderfolgende Renderings finden dort dasselbe Objekt wieder, auch wenn
sich seine Position ändert.

Wenn die Liste aus Strings oder Zahlen besteht, folgt man dem Wert selbst: `track tech` bei den
Tags eines Projekts, `track lang` bei den Sprachen, `track speed` bei den Wiedergabegeschwindigkeiten. Der Wert
dient als Schlüssel.

Bleibt `track $index`, für Positionslisten, die sich nie umsortieren. Der Text eines
aus seinem Markdown gerenderten Artikels ist dafür das Beispiel: die geparsten Blöcke behalten ihre Reihenfolge, der Index
ist also ein legitimer Schlüssel.

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

`@for` kann auch `$index` unter einem Namen bereitstellen: `@for (filter of content.articleFilters; track
filter; let index = $index)` hält den Index griffbereit, um den aktiven Filter zu markieren. Den Block
`@empty` gibt es an keiner Stelle des Projekts. Der Fall „leere Liste" wird über ein separates, vor dem Grid platziertes `@if`
behandelt, `@if (filtered().length === 0)`, weil die Meldung für fehlende
Ergebnisse an einer anderen Stelle im Layout lebt als das Grid selbst.

## `@switch` zum Rendern von Markdown

Der obige Ausschnitt zeigt die eigentliche Verwendung von `@switch` im Projekt: einen Baum aus Markdown-Blöcken
auf die passenden Elemente projizieren. `@switch (block.type)` leitet jeden Knoten (`h2`, `p`, `ul`,
`code`, `quote`) an seine Render-Komponente weiter. Ein zweites `@switch (run.kind)` erledigt dieselbe Arbeit eine
Ebene tiefer, in `sd-inline-runs`, um Text, Link und Inline-Code innerhalb eines
Absatzes zu unterscheiden.

Das ist Inhalt, keine App-UI: jeder `@case` entspricht einer geschlossenen Variante des
Datenmodells, und der Compiler prüft die Templates jedes Zweigs.

## Was „weniger JS beim Start" hier bedeutet

Der Control Flow macht Templates lesbar, senkt aber für sich genommen nicht das beim ersten Laden
heruntergeladene JavaScript. Diese Arbeit läuft über zwei Mechanismen: den Router und ein
`@defer`.

Jedes Feature wird bei Bedarf geladen. `app.routes.ts` deklariert vierzehn `loadComponent`- oder
`loadChildren`-Punkte; die Seiten `articles`, `series` und `projects` haben sogar ihren eigenen
Lazy-Route-Teilbaum:

```typescript
{
  path: 'articles',
  loadChildren: () =>
    import('./features/articles/articles.routes').then((m) => m.ARTICLES_ROUTES),
},
```

Der dynamische `import()` ist das, wonach der Bundler sucht, um einen separaten Chunk zu erstellen. Solange ein Besucher nicht
auf `/articles` geht, wird der Code dieser Seite nicht ins Netz geschickt. Das erste Laden transportiert
nur die angezeigte Route.

`@defer` verschiebt dieselbe Idee unter die Route, innerhalb eines Templates. Es umschließt ein Fragment,
dessen Code aus dem aktuellen Chunk austritt und erst beim gewählten Trigger ankommt: `on viewport`,
`on interaction`, `on idle`, `on hover`, `on immediate` oder `on timer`. Es kommt mit seinen
Hilfsblöcken, beschrieben im [Guide zum verzögerten Laden](https://angular.dev/guide/templates/defer):

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

Der `@placeholder` wird vor jedem Trigger gerendert und kann den Trigger selbst tragen. Der `@loading` deckt
die Zeit ab, die zum Abrufen des Chunks nötig ist, mit einem `after`, der seine Anzeige verzögert, um bei einer schnellen
Verbindung nicht zu flackern. Der `@error` übernimmt, falls der Chunk nicht lädt.

## Das `@defer` auf der Spiel-Engine

Die Spielkomponente, `sd-bsp-demo`, zieht die ganze Engine hinter sich her: `asset-loader`,
`combat-runtime`, `pickup-runtime`, die Painter, die KI der Gegner. Der Build macht daraus einen eigenen Chunk,
`bsp-demo-component`, mit 261 kB roh, 69 kB nach Gzip-Kompression.

Dieser Code wird erst nach einem Klick auf den Controller des Players benötigt, und nahezu alle Besucher lösen ihn
nie aus. Das `@if (game.running())` konditionierte nur das **Rendering**: die Engine
selbst landete im Chunk der Home und blieb dort, umsonst geladen.

Der Block ist jetzt in ein `@defer` eingehüllt, innerhalb des bereits von der
Bedingung geschützten Zweigs:

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

Der Trigger `on immediate` lädt den Chunk, sobald der Block ins DOM eintritt. Da dieser Block unter
`@else if (game.running())` lebt, tritt er erst ins DOM ein, wenn das Spiel gestartet ist: die Bedingung sortiert
bereits vor, `on immediate` zieht den Code nur genau in dem Moment, in dem der Zweig angezeigt wird. Solange
das Spiel nicht läuft, wird der `@else`-Zweig gerendert, also der normale Player; es gibt
also nichts für einen `@placeholder`, und die Anzeige ändert sich nicht.

`BspDemoComponent` bleibt im `imports`-Array des Players. Angular verschiebt automatisch eine
Standalone-Komponente, deren einzige Verwendungsstelle innerhalb eines `@defer` liegt: kein manueller
`import()` nötig, und die Deklaration muss nicht entfernt werden.

Das Ergebnis zeigt sich am Production-Build. Beim Laden von `/fr` und Auslesen des Resource-Timings
(`performance.getEntriesByType('resource')`) sinkt das JavaScript der Home von 774.534 auf 514.771
Byte roh, und von zwölf auf elf Dateien. Das sind 259.763 Byte weniger, rund −260 kB roh,
knapp 33 % des JS der Startseite; im Netz wiegt der entfernte Chunk 69 kB nach Kompression.
Die Messung ist punktuell, einmalig an einem echten Build vorgenommen, kein gemittelter Benchmark.

Die Unterscheidung bleibt bestehen. Der Control Flow entscheidet, was angezeigt wird; die Aufteilung nach Route und
`@defer` entscheiden, was heruntergeladen wird. Das Projekt wendet Ersteres überall an, Letzteres auf die
Routen, und nun auch auf diesen konkreten Block.

> Der neue Control Flow hat die Templates abgeflacht und `CommonModule` aus dem Code entfernt. Den
> Start zu entlasten bleibt eine eigenständige Aufgabe: sie läuft über den Router und über ein `@defer`
> auf der Spiel-Engine, das ein Drittel des JavaScript der Startseite entfernt, um es nur an den
> Besucher zu senden, der das Spiel startet.
