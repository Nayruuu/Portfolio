Der neue Control Flow von Angular ersetzt nicht einfach nur `*ngIf` und `*ngFor` durch eine schönere Syntax. In Kombination mit `@defer` verändert er, was im initialen Bundle landet: Beim Start wird nur das JavaScript ausgeliefert, das für das erste Rendering tatsächlich benötigt wird, der Rest kommt bei Bedarf.

## @if, @for, @switch

Die `@`-Syntax ist in den Compiler integriert: kein Direktiven-Import erforderlich, und ein **obligatorisches** `track` bei `@for`, das dazu zwingt, über die Identität der Elemente nachzudenken. Dieses `track` verhindert, dass das DOM bei jeder Listenänderung komplett neu erstellt wird.

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

Der `@empty`-Block von `@for` und das erschöpfende `@case` von `@switch` decken Fälle ab, die bei strukturellen Direktiven oft vergessen wurden.

## @defer : Später laden

`@defer` umschließt einen Template-Abschnitt, dessen Code aus dem Haupt-Bundle herausgelöst und als **separater Chunk** geladen wird, wenn es an der Zeit ist. Der Auslöser entscheidet wann: `on viewport` lädt, wenn der Block in den sichtbaren Bereich eintritt, `on interaction` beim ersten Klick/Fokus, `on idle` wenn der Browser inaktiv ist, `on hover` oder `on timer`.

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

### Die Hilfsblöcke

- `@placeholder` : wird **vor** jeder Auslösung gerendert; er kann den Trigger `on viewport`/`on interaction` tragen. Das `minimum` verhindert ein zu kurzes Aufblitzen.
- `@loading` : während des Chunk-Ladevorgangs; `after` verzögert die Anzeige, um auf schnellen Verbindungen kein Flackern zu erzeugen.
- `@error` : wenn der Chunk nicht geladen werden kann (z. B. bei unterbrochener Verbindung).

Mit `prefetch on hover` kann man außerdem vorladen, ohne etwas anzuzeigen, damit der Klick sofort reagiert, ohne den Start zu belasten.

## Die Auswirkung auf das Bundle

Jede Komponente, Direktive oder Pipe, die **ausschließlich** in einem `@defer`-Block verwendet wird, wird in einen eigenen Chunk extrahiert. Eine schwere Seite – Code-Editor, Diagramme, Karte – kann so 100 bis 200 KB aus dem initialen Bundle herauslösen, die nur heruntergeladen werden, wenn der Nutzer bis dorthin scrollt. Der Gewinn ist direkt am **Largest Contentful Paint** und an der Time to Interactive messbar. Die Dokumentation beschreibt jeden Auslöser im Detail im [Leitfaden zum verzögerten Laden](https://angular.dev/guide/templates/defer).

Achtung jedoch: Ein `@defer (on viewport)`, der oberhalb der Falz platziert ist, wird sofort ausgelöst und bringt nichts. Verzögertes Laden ergibt nur Sinn für Inhalte, die **außerhalb des sichtbaren Bereichs** oder bedingt sind.

> Der Control Flow macht die Absicht lesbar, `@defer` macht die Kosten explizit. Anstatt alles „auf Verdacht" zu laden, deklarierst du, wann jedes Stück sein JavaScript verdient – und der Start wird von selbst leichter.
