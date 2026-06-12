## Das resource()-Modell

Ein `resource()` verknüpft eine reaktive **Anfrage** mit einem asynchronen **Loader**. Wenn ein in `params` gelesenes Signal sich ändert, startet Angular den Loader automatisch neu und bricht die laufende Anfrage über ein `AbortSignal` ab. Das Ergebnis ist ein Signal-Objekt: `value()`, `error()`, `status()` sowie `isLoading()`.

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

Es genügt, `userId` zu ändern: kein `subscribe`, kein `takeUntilDestroyed`. Der `resource` lädt neu, gibt `isLoading()` während des Aufrufs aus und bricht die vorherige Anfrage ab.

## httpResource für REST-Aufrufe

`httpResource()` ist die auf `HttpClient` zugeschnittene Variante: Sie durchläuft die Interceptoren, verwaltet die Typisierung der Antwort und reagiert auf URL-Änderungen. Man übergibt ihr eine Funktion, die die aus Signals abgeleitete URL (oder ein vollständiges Anfrage-Objekt) zurückgibt.

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

Im Template werden die Zustände direkt konsumiert, ohne `async`-Pipe:

```typescript
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

### Die Zustände und ihre Tücken

`status()` gibt einen der Werte `idle`, `loading`, `reloading`, `resolved`, `error` und `local` zurück. Zwei Feinheiten verdienen Beachtung:

- Während eines **Neuladens** behält `value()` die alten Daten (`reloading`), was einen weißen Bildschirm verhindert — praktisch für ein Stale-while-revalidate-Pattern.
- `httpResource` ist für das **Lesen** (GET) gedacht. Für POST/PUT bleibt man beim klassischen `HttpClient`: Ein Resource startet neu, sobald sich seine Anfrage ändert, was bei einer Mutation keinen Sinn ergibt.

## Warum manuelle Subscriptions aufgeben

Imperativer RxJS-Code vermischt drei Anliegen: den Aufruf auslösen, den Stream mappen und bereinigen. Mit `resource` wird die **Abhängigkeit** deklarativ — der Loader startet neu, weil sich ein Signal geändert hat, Punkt. Man entfernt die Paginierungs-`BehaviorSubject`s, die defensiven `switchMap`s und die `finalize`-Aufrufe, um `loading` wieder auf `false` zu setzen. Die offizielle Dokumentation beschreibt die API im [Async-Guide mit resource](https://angular.dev/guide/signals/resource).

> `resource()` ersetzt nicht RxJS: Es ersetzt den **Boilerplate**. Du beschreibst, was geladen werden soll und wovon es abhängt; Angular kümmert sich um das Wann, den Abbruch und den Zustand. Die Komponente wird wieder zu einer einfachen Signal-Lektüre.
