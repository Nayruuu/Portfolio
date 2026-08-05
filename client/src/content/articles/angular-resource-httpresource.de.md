Angular asynchrone Daten zu laden bedeutete lange Zeit ein manuelles `subscribe()`, ein von Hand
gepflegtes Zustands-Tripel (`loading`, `error`, `value`) und ein Speicherleck, sobald ein
`unsubscribe` fehlte. Angular 21 räumt diese Verkabelung hinter zwei reaktive, auf **Signals**
aufgebaute Primitiven auf: `resource()` und seine HTTP-Variante `httpResource()`.

## Das resource()-Modell

Ein `resource()` verbindet eine reaktive `params`-Funktion mit einem asynchronen `loader`. `params`
liefert die auszuführende Anfrage zurück; der `loader` wandelt sie in Daten um. Sobald sich ein in
`params` gelesenes Signal ändert, startet Angular den `loader` neu und bricht den noch laufenden
Aufruf ab.

Der `loader` erhält drei Dinge: die aufgelösten `params`, ein `abortSignal` und `previous` (den
Status des vorherigen Ladevorgangs). Das `abortSignal` ist der entscheidende Punkt: verkabelt mit dem
`fetch`, unterbricht es die veraltete Anfrage, statt sie weiterlaufen zu lassen.

```typescript
import { resource, signal } from '@angular/core';

export class UserCard {
  private readonly userId = signal(1);

  protected readonly user = resource({
    params: () => ({ id: this.userId() }),
    loader: ({ params, abortSignal }) =>
      // The fetch option is `signal`, not `abortSignal`: wiring it lets a stale request abort.
      fetch(`/api/users/${params.id}`, { signal: abortSignal }).then((response) =>
        response.json(),
      ),
  });

  protected next(): void {
    this.userId.update((id) => id + 1);
  }
}
```

Es genügt, `userId` zu ändern: kein `subscribe`, kein `takeUntilDestroyed`. Die Resource lädt neu,
zeigt `isLoading()` während des Aufrufs an und verwirft die vorherige Anfrage. Das Ergebnis ist ein
Objekt aus Signals, das man liest: `value()`, `error()`, `status()`, `isLoading()`.

## httpResource für REST-Aufrufe

`httpResource()` ist die auf `HttpClient` zugeschnittene Variante: Sie durchläuft die Interceptors,
typisiert die Antwort und reagiert auf URL-Änderungen. Man übergibt ihr eine Funktion, die die URL
zurückgibt, oder ein vollständiges, aus Signals abgeleitetes Anfrageobjekt.

Eine konkrete Voraussetzung: `httpResource` stützt sich auf das `fetch`-Backend, daher braucht es
`provideHttpClient(withFetch())` an der Wurzel. Dieses Portfolio aktiviert das bereits in
`app.config.ts`, ruft `httpResource` selbst aber noch nicht auf (seine Schreibvorgänge laufen weiterhin
über `HttpClient`, siehe weiter unten). Gibt die Anfragefunktion `undefined` zurück, wird kein Aufruf
ausgelöst, was einen bedingten Fetch ohne `*ngIf` oder manuelle Guard-Logik ermöglicht.

```typescript
import { httpResource } from '@angular/common/http';
import { signal } from '@angular/core';

export class ArticleList {
  protected readonly tag = signal<string | undefined>(undefined);

  // Re-fetches whenever tag() changes; interceptors and response typing still apply.
  protected readonly articles = httpResource<Article[]>(() => ({
    url: '/api/articles',
    params: this.tag() ? { tag: this.tag() } : {},
  }));
}
```

Die Option `parse` verdient es, bekannt zu sein: Sie erhält die rohe Antwort und gibt den
endgültigen Typ zurück, wodurch sich der Server-Vertrag mit einem Runtime-Schema (etwa Zod)
validieren lässt, statt einem `as` zu vertrauen. Die Antwort wird zur Laufzeit geprüft, nicht nur
zur Kompilierzeit typisiert.

Standardmäßig wird die Antwort als JSON geparst. Für ein anderes Format bieten `httpResource.text()`,
`.blob()` und `.arrayBuffer()` dieselbe reaktive Mechanik für Text oder Binärdaten. Und
`defaultValue` legt fest, was `value()` vor dem ersten Ladevorgang zurückgibt: Übergibt man hier `[]`,
vermeidet man den `idle`-Zweig im Template — die Liste startet leer und füllt sich dann.

Im Template werden die Zustände direkt konsumiert, ohne `async`-Pipe:

```html
@if (articles.isLoading()) {
  <p>Chargement…</p>
} @else if (articles.error()) {
  <p>Échec du chargement.</p>
} @else {
  @for (article of articles.value(); track article.id) {
    <h3>{{ article.title }}</h3>
  }
}
```

## Die Zustände, und was sie im Gedächtnis behalten

`status()` gibt einen von `idle`, `loading`, `reloading`, `resolved`, `error` und `local` zurück.
Ein paar Details verändern die Art, eine Komponente zu schreiben.

Während eines Neuladens behält `value()` die alte Daten bei, und `status()` wechselt zu `reloading`
statt zu `loading`. Der Bildschirm leert sich nicht: Man zeigt die veralteten Daten an, die
frischen ersetzen sie, sobald sie eintreffen. Das ist Stale-While-Revalidate ohne zusätzlichen Code.

`hasValue()` ist ein Type Guard. In einem `@if (user.hasValue())`-Zweig weiß TypeScript, dass
`value()` nicht mehr `undefined` ist, was das defensive `?.` erspart, das sich überall einschleicht,
sobald der Wert fehlen kann.

Die Option `equal` ergänzt das Bild: Sie vergleicht die alten und neuen Daten, und wenn sie als
gleich beurteilt werden, benachrichtigt das Signal seine Leser nicht. Ein Neuladen, das eine
identische Antwort liefert, löst dann kein unnötiges Rendering weiter unten aus.

## Neu laden und abbrechen

`reload()` erzwingt einen neuen Aufruf, ohne die `params` zu ändern — für einen
„Aktualisieren"-Button oder eine Invalidierung nach einer Aktion. Es gibt einen Boolean zurück:
`false`, wenn die Resource bereits lädt.

Der Abbruch löst eine Klasse subtiler Bugs. Mit einem `switchMap` musste man das vorherige
Abonnement manuell abbrechen, damit eine langsame, veraltete Antwort keine aktuelle Antwort
überschreibt. Die Resource erledigt das konstruktionsbedingt: Ändert sich `params`, wird das
`abortSignal` des laufenden Aufrufs ausgelöst. Das Rennen, bei dem eine alte Antwort nach der neuen
eintrifft, existiert nicht mehr, und man entfernt dabei gleich die defensiven `switchMap`,
die `finalize`, die `loading` wieder auf `false` setzen, und die `BehaviorSubject` für Paginierung.

## In eine Resource schreiben, und wo es endet

`value` ist ein beschreibbares Signal. `set()`, `update()` oder `value.set()` ersetzen die Daten
lokal, und `status()` wechselt dann bis zum nächsten Neuladen auf `local`. Das macht optimistisches
UI einfach: Man zeigt das erwartete Ergebnis sofort an, der Netzwerkaufruf gleicht es anschließend ab.

```typescript
// Local write: the value updates immediately and status() becomes 'local'.
this.cart.update((items) => [...items, product]);

// The persistence itself is a plain HttpClient call, not a resource.
await firstValueFrom(this.http.post('/api/cart', product));
```

Das ist auch die Grenze der Primitive. `httpResource` ist für **Lesevorgänge** gedacht: Es startet
neu, sobald sich seine Anfrage ändert, was für ein einmalig ausgelöstes POST keinen Sinn ergibt.
Schreibvorgänge bleiben bei `HttpClient`. Der API-Seam dieses Portfolios zeigt das: `FeedbackApiService`
postet eine Stimme und `ContactApiService` sendet ein Formular über `http.post(...)`, eingebettet in
`firstValueFrom` und ein `timeout`, weil es sich um Mutationen handelt, die den frischen
Server-Zustand zurückgeben. Eine Resource hätte dort nichts gebracht.

Die daraus folgende Regel ist klar: Ein Lesevorgang, der von Signals abhängt, läuft über `resource`
oder `httpResource`; ein Schreibvorgang bleibt ein expliziter `HttpClient`-Aufruf. Die
[offizielle Dokumentation](https://angular.dev/guide/signals/resource) beschreibt die vollständige API.

> `resource()` ersetzt die Verkabelung, nicht RxJS. Man beschreibt, was zu laden ist und wovon es
> abhängt; Angular kümmert sich um das Wann, den Abbruch und den Zustand. Die Komponente wird wieder
> zu einem Lesen von Signals, und die Mutationen behalten den einzigen Ort, an dem sie schon immer
> hingehörten, einen bewusst gesetzten HTTP-Aufruf.
