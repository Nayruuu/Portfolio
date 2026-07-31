Lange Zeit war das Laden asynchroner Daten gleichbedeutend mit manuellem `subscribe()`, händischem
State-Management (`loading`, `error`, `data`) und Memory-Leaks, wenn man ein `unsubscribe` vergaß.
Seit Angular 21 kapseln `resource()` und `httpResource()` all das in einer reaktiven Primitive, die
auf **Signals** aufbaut.

## Das resource()-Modell

Ein `resource()` verknüpft eine reaktive **Anfrage** mit einem asynchronen **Loader**. Ändert sich
ein in `params` gelesenes Signal, startet Angular den Loader automatisch neu und bricht die laufende
Anfrage über ein `AbortSignal` ab. Das Ergebnis ist ein Objekt aus Signals: `value()`, `error()`,
`status()`, plus `isLoading()`.

```typescript
import { resource, signal } from '@angular/core';

export class UserCard {
  private readonly userId = signal(1);

  protected readonly user = resource({
    params: () => ({ id: this.userId() }),
    loader: ({ params, abortSignal }) =>
      fetch(`/api/users/${params.id}`, { abortSignal }).then((response) =>
        response.json(),
      ),
  });

  protected next(): void {
    this.userId.update((id) => id + 1);
  }
}
```

Es genügt, `userId` zu ändern: kein `subscribe`, kein `takeUntilDestroyed`. Die `resource` lädt neu,
stellt `isLoading()` während des Aufrufs bereit und bricht die vorherige Anfrage ab.

## httpResource für REST-Aufrufe

`httpResource()` ist die Variante, die auf `HttpClient` zugeschnitten ist: Sie durchläuft die
Interceptors, kümmert sich um die Typisierung der Antwort und reagiert auf Änderungen der URL. Man
übergibt ihr eine Funktion, die die aus Signals abgeleitete URL (oder ein vollständiges
Request-Objekt) liefert.

```typescript
import { httpResource } from '@angular/common/http';
import { signal } from '@angular/core';

export class ArticleList {
  protected readonly tag = signal<string | undefined>(undefined);

  protected readonly articles = httpResource<Article[]>(() => ({
    url: '/api/articles',
    params: this.tag() ? { tag: this.tag() } : {},
  }));
}
```

Im Template konsumiert man die States direkt, ohne `async`-Pipe:

```typescript
@if (articles.isLoading()) {
  <p>Wird geladen…</p>
} @else if (articles.error()) {
  <p>Laden fehlgeschlagen.</p>
} @else {
  @for (article of articles.value(); track article.id) {
    <h3>{{ article.title }}</h3>
  }
}
```

### Die States und ihre Fallstricke

`status()` liefert einen Wert aus `idle`, `loading`, `reloading`, `resolved`, `error` und `local`.
Zwei Feinheiten:

- während eines **Reloads** behält `value()` den alten Wert (`reloading`), was einen leeren
  Bildschirm vermeidet. Praktisch für ein Stale-while-revalidate-Pattern.
- `httpResource` ist für das **Lesen** (GET) gedacht. Für POST/PUT bleibt man bei einem
  klassischen `HttpClient`: Eine resource startet neu, sobald sich ihre Anfrage ändert, was bei
  einer Mutation keinen Sinn ergibt.

## Warum man manuelle Subscriptions aufgibt

Der imperative RxJS-Code vermischt drei Anliegen: den Aufruf auslösen, den Stream mappen und
aufräumen.

Mit `resource` wird die **Abhängigkeit** deklarativ: Der Loader startet neu, weil sich ein Signal
geändert hat. Man entfernt die `BehaviorSubject` für Pagination, die defensiven `switchMap` und die
`finalize`, um `loading` wieder auf `false` zu setzen. Die offizielle Doku beschreibt die API im
[Async-Guide mit resource](https://angular.dev/guide/signals/resource).

> `resource()` ersetzt die **Verkabelung**, nicht RxJS. Du beschreibst, was geladen werden soll und
> wovon es abhängt; Angular kümmert sich um das Wann, den Abbruch und den State. Die Komponente wird
> wieder zu einem einfachen Lesen von Signals.
