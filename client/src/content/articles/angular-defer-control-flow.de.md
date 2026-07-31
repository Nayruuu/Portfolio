Angular hat `*ngIf` und `*ngFor` durch einen neuen Control Flow ersetzt, der zusammen mit `@defer` ausgeliefert wird.
Diese Kombination ändert, was im initialen Bundle landet: Beim Start wird nur das JavaScript ausgeliefert, das für den ersten Render tatsächlich benötigt wird, der Rest kommt bei Bedarf nach.

## @if, @for, @switch

Die `@`-Syntax ist in den Compiler integriert: kein Directive-Import, und ein **verpflichtendes** `track` bei `@for`, das dazu zwingt, über die Identität der Elemente nachzudenken. Genau dieses `track` verhindert, dass bei jeder Listenänderung alles im DOM neu erzeugt wird.

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

Der `@empty`-Block von `@for` und der erschöpfende `@case` von `@switch` decken Fälle ab, die man bei den strukturellen Directives häufig vergaß.

## @defer: später laden

`@defer` umschließt einen Template-Ausschnitt, dessen Code aus dem Hauptbundle herausgelöst und als **separater Chunk** zum gewünschten Zeitpunkt geladen wird. Der Trigger entscheidet, wann: `on viewport` lädt, wenn der Block ins Bild scrollt, `on interaction` beim ersten Klick/Fokus, `on idle`, wenn der Browser untätig ist, `on hover` oder `on timer`.

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

### Die Nebenblöcke

- `@placeholder`: wird **vor** jeder Auslösung gerendert, er kann den Trigger `on viewport`/`on interaction` tragen. Das `minimum` verhindert ein zu kurzes Aufflackern.
- `@loading`: während des Ladens des Chunks; `after` verzögert dessen Anzeige, damit es bei einer schnellen Verbindung nicht flackert.
- `@error`: falls der Chunk nicht lädt (z. B. bei unterbrochenem Netzwerk).

Man kann auch vorab laden, ohne anzuzeigen, mit `prefetch on hover`, damit der Klick sofort wirkt, ohne den Start zu belasten.

## Die Auswirkung auf das Bundle

Jede Komponente, Directive oder Pipe, die **ausschließlich** in einem `@defer`-Block verwendet wird, wird in ihren eigenen Chunk extrahiert.

Eine schwergewichtige Seite (Code-Editor, Diagramme, Karte) kann so 100 bis 200 kB aus dem initialen Bundle herausnehmen, die nur heruntergeladen werden, wenn der Nutzer bis dorthin scrollt. Der Gewinn zeigt sich direkt am **Largest Contentful Paint** und an der Zeit bis zur Interaktivität.

Die Doku beschreibt jeden Trigger im Detail im
[Guide zum verzögerten Laden](https://angular.dev/guide/templates/defer).

Vorsicht jedoch: Ein `@defer (on viewport)`, der oberhalb der Sichtbarkeitsgrenze platziert ist, löst sofort aus und bringt nichts. Das verzögerte Laden ergibt nur Sinn für das, was **außerhalb des Bildschirms** oder bedingt ist.

> Der Control Flow macht die Absicht lesbar, und `@defer` hängt jedem Template-Stück explizite Kosten an. Statt alles „sicherheitshalber“ zu laden, legt man fest, wann jeder Block sein JavaScript verdient, und der Start wird leichter.
