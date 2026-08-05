Diese Anwendung läuft ohne zone.js. Nicht hinter einem experimentellen Flag: Das Paket steckt
weder in der `package.json` noch in `node_modules`, und `angular.json` deklariert `"polyfills": []`. Die
Change Detection wird von Signals gesteuert, und nur von ihnen. Im Folgenden wird beschrieben, wie das
in diesem Portfolio verdrahtet ist, und an vier oder fünf Stellen, an denen das Fehlen von Zone die
Art, Code zu schreiben, wirklich verändert.

## Was zone.js erledigte, und was jetzt übernimmt

zone.js patchte alle asynchronen Browser-APIs (`setTimeout`, Promises, DOM-Listener), um Angular
zu benachrichtigen, sobald ein Callback beendet war. Bei jeder Benachrichtigung startete ein
Detection-Zyklus von der Wurzel aus neu und überprüfte den gesamten Baum erneut, auch die
Komponenten, bei denen sich nichts verändert hatte.

Im Zoneless-Modus verschwindet dieses Monkey-Patching. Eine Komponente wird zur Überprüfung markiert,
wenn ein Signal, das sie in ihrem Template liest, eine Änderung meldet. Hinzu kommen einige
explizite Auslöser: ein Event-Handler im Template, ein `markForCheck`, die Aktualisierung eines
`input()`.

Die Konsequenz ist direkt. Ein `setTimeout`, das ein gewöhnliches Feld neu schreibt, löst keinerlei
Refresh mehr aus. Mit zone.js fing der globale Tick diese Art von Mutation ab, ohne dass man daran
denken musste. Ohne ihn muss jede Änderungsquelle über ein Signal laufen, sonst bleibt die Ansicht
eingefroren.

Das ist ein strengerer, aber auch lesbarerer Vertrag: Reaktivität hört auf, ein Nebeneffekt der
Laufzeitumgebung zu sein, und wird stattdessen zu einem Datum im Code.

## Die Aktivierung, ein einziger Provider

Alles spielt sich in `app.config.ts` ab. `provideZonelessChangeDetection()` ersetzt das frühere
`provideZoneChangeDetection`, und der Rest der Konfiguration begleitet diese Wahl.

```typescript
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
  ],
};
```

`withComponentInputBinding()` verknüpft Routenparameter mit den `input()` der Komponenten: Der
`:slug` der Artikelseite landet direkt in einem `input.required<string>()`, ohne manuelles Lesen
des Snapshots. `provideClientHydration(withEventReplay())` spielt Ereignisse erneut ab, die
während der Hydration aufgetreten sind, was ohne Zone stärker ins Gewicht fällt: Nichts fängt mehr
im Hintergrund einen Klick auf, der eintraf, bevor die App interaktiv war.

## Das reaktive Rückgrat

Die gesamte App liest den mehrsprachigen Inhalt über ein einziges Signal. `I18nService` ist eine
dünne Fassade über einem [NgRx](https://ngrx.io/guide/signals) `SignalStore` und exponiert nur drei
lesbare Signale: `lang`, `content` und `loading`, typisiert als `Signal<Lang>` / `Signal<Content>` /
`Signal<boolean>`. Die Konsumenten hängen nie von der internen Form des Stores ab.

Der Store folgt einer Stale-while-revalidate-Logik. Beim Start füllt ein synchrones `peek()` den
Inhalt (sofortiges erstes Rendering, kompatibel mit dem statischen Prerender), anschließend
revalidiert ein asynchrones `getContent()` diesen. Ein Sprachwechsel ist durch ein Last-wins-Muster
abgesichert: Wenn zwischenzeitlich eine neuere Sprache angefordert wurde, wird das alte Ergebnis
verworfen.

Der DOM-Nebeneffekt lebt in einem `withHooks` des Stores, über einen `effect`, der auf `lang()`
reagiert: Er persistiert die Präferenz in `localStorage` und spiegelt den Wert auf `<html lang="…">`.
Niemand ruft diesen Code auf, er wird erneut ausgeführt, wenn sich das Signal ändert.

Der Nutzen zeigt sich im Gebrauch. Ein Sprachwechsel aktualisiert `content()`, und jedes `computed`
oder Template, das es liest, wird ohne ein einziges manuelles Abonnement neu berechnet.

## Der abgeleitete Zustand berechnet sich von selbst

Die Artikelseite veranschaulicht die komplette Kette. Der Routenparameter ist ein `input`, alles
Weitere ergibt sich daraus per `computed`:

```typescript
/** Route param `:slug`, bound via withComponentInputBinding. */
protected readonly slug = input.required<string>();

protected readonly article = computed<Article>(() => {
  const articles = this.i18n.content().articles;
  const index = articles.findIndex((a) => a.slug === this.slug());

  return articles[index] ?? articles[0];
});

protected readonly body = computed(() =>
  parseMarkdown(ARTICLE_BODIES[this.article().slug]?.[this.i18n.lang()] ?? ''),
);
```

`article` hängt von `slug()` und `content()` ab; `body` hängt von `article()` und `lang()` ab.
Zu einem anderen Artikel zu navigieren oder die Sprache umzuschalten, setzt das Ganze ohne
Synchronisationscode neu zusammen. Die `computed` sind memoisiert: `body` parst das Markdown nur
dann neu, wenn sich der Slug oder die Sprache tatsächlich geändert hat.

Dasselbe Prinzip strukturiert `PlayerService`, der den simulierten Player der Startseite steuert.
Die Wiedergabezeit (`time`) und der Play/Pause-Zustand (`playing`) sind beschreibbare Signale. Die
Liste der Kapitel leitet sich über `this.i18n.content().chapters` aus der Sprache ab, das aktuelle
Kapitel leitet sich aus der Zeit ab, und die in diesem Kapitel verstrichene Zeit leitet sich aus
beiden ab. Das Template zeigt `currentChapter()` an und folgt automatisch, ohne `ngOnChanges` oder
manuell ausgelöste Neuberechnung.

Auch die Ein- und Ausgaben der Komponenten sind Signale. Die Player-Szenen erhalten ihre Uhr über
`input.required<number>()` und ihren Aktiv-Zustand über `input.required<boolean>()`, zwei Werte,
die direkt `computed` speisen. Die BSP-Demo meldet ihre Ereignisse per `output<void>()` an das
Elternelement zurück. Für wirklich triviale lokale Zustände kann sich ein Service auf eine Zeile
reduzieren: Die Suche der Navigationsleiste ist ein einfaches
`public readonly query = signal('')`, geschrieben von der Nav-Leiste, gelesen vom Artikelraster.

Alle Komponenten der App laufen mit `ChangeDetectionStrategy.OnPush`. Im Zoneless-Modus ist das
durchgängig konsequent: Eine Ansicht wird nur überprüft, wenn ein von ihr konsumiertes Signal es
verlangt.

## Ein von einem Signal gesteuertes Intervall

Der heikle Punkt beim Zoneless-Modus ist imperativer asynchroner Code. `PlayerService` lässt eine
Wiedergabeuhr mit einem `setInterval` voranschreiten, aber das `setInterval` lebt innerhalb eines
`effect`, der vom Signal `playing` gesteuert wird.

```typescript
constructor() {
  // Drive the tick loop reactively from `playing`.
  effect((onCleanup) => {
    if (!this.playing()) {
      return;
    }
    const intervalId = setInterval(() => {
      const next = this.time() + 0.1 * this.rate();

      this.time.set(next >= this.totalSec() ? 0 : next);
    }, 100);

    onCleanup(() => clearInterval(intervalId));
  });
}
```

Wenn `playing` auf `false` wechselt, wird der Effekt erneut ausgeführt, `onCleanup` läuft vorher
und `clearInterval` stoppt die Schleife. Das im Tick gelesene `rate()` variiert den Schritt, ohne
dass irgendetwas neu aufgebaut werden muss.

Dieses `onCleanup` zu vergessen ist die klassische Falle. Das Intervall würde die Pause überleben,
nach mehreren Umschaltungen mehrfach parallel laufen und in Tests genauso wie beim SSR-Prerender
lecken, wo der Timer nie einen Grund hätte, anzuhalten. Das `set()` auf `time` bleibt der einzige
Kanal, über den der Tick die Ansicht informiert: Ohne zone.js wacht Angular nur beim Schreiben des
Signals auf, nie durch das `setInterval` selbst.

## Wenn RxJS ein Signal speisen muss

RxJS existiert noch in der App, aber am Rand, und es steuert nie direkt ein Template. Die
Bewertungsleiste muss ihre Zähler bei jeder Navigation zwischen Artikeln neu laden: Sie hängt sich
mit einem `filter` auf `NavigationEnd` und einem `takeUntilDestroyed()` an `router.events`, und im
`subscribe` ruft sie ein `load()` auf, das mit einem `this.tally.set(...)` endet.

Der Stream dient als Auslöser, das Signal trägt den Zustand. `takeUntilDestroyed()` meldet beim
Zerstören der Komponente ab, ohne manuelles `ngOnDestroy`. Die API `toSignal()` würde dieselbe
Brücke deklarativ schlagen, aber dieses Portfolio brauchte sie nicht: Hier laufen die seltenen
Streams auf ein `set()` im `subscribe` hinaus.

## Die Regel, die das Abdriften verhindert

„Alles ist ein Signal" ist leicht gesagt und leicht verraten: Es genügt ein Entwickler, der aus
Reflex `public loading = false` schreibt. Eine hausgemachte ESLint-Regel, `local/prefer-signal-primitives`,
wahrt die Disziplin.

Sie inspiziert jedes öffentliche Feld, dessen Typ oder Anfangswert primitiv ist (Boolean, String,
Number, `bigint`, Literal oder Union von Primitiven), und meldet einen Fehler, wenn es nicht mit
`signal()`, `computed()`, `model()` oder `input()` initialisiert wird. Die Meldung ist eindeutig:
`Public primitive field '{{name}}' should be a signal`. Sie ist als `error` auf das gesamte
`src/app/**/*.ts` geschaltet, die Specs ausgenommen.

Der Effekt ist, dass ein exponiertes und als mutable Primitiv belassenes Zustandsfeld beim Lint
nicht mehr kompiliert. Die Konvention hängt nicht von der Wachsamkeit jedes Einzelnen ab; sie wird
bei jedem Build überprüft.

## Testen, wenn es keine Zone mehr gibt

Ohne zone.js gibt es kein `fakeAsync` und kein `tick()` mehr: Das Projekt enthält keinerlei
Vorkommen davon. Zwei Muster ersetzen sie, beschrieben im [Zoneless-Guide](https://angular.dev/guide/zoneless).

Bei einer Komponente handelt man und wartet dann auf Stabilität:
`await fixture.whenStable()` nach einer Interaktion, bevor man Zusicherungen über das DOM trifft.
Rund zwanzig Komponenten-Specs folgen diesem Schema.

Für die Uhr von `PlayerService` muss die Change Detection manuell gesteuert werden. Man erzwingt
die Timer von Vitest, flusht den Effekt mit `ApplicationRef.tick()` (was das `setInterval`
programmiert) und lässt dann die Zeit voranschreiten.

```typescript
it('the tick advances while playing, and onCleanup stops it on pause', () => {
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

Der Test überprüft beide Hälften des Vertrags: Die Uhr schreitet während der Wiedergabe um 0,1 pro
hundert Millisekunden voran, und nach `pause()` plus `appRef.tick()` bewegt ein Vorrücken um eine
ganze Sekunde die Zeit nicht mehr. `onCleanup` hat das Intervall korrekt unterbrochen. Das ist
Zoneless-Code, der so getestet wird, wie er läuft: Die Änderungen sind explizit, man entscheidet,
wann sie stattfinden.

> Der Zoneless-Modus macht die App nicht auf magische Weise schneller. Was er verändert, ist die
> Nachvollziehbarkeit: Jedes Neuzeichnen lässt sich auf ein bestimmtes Signal zurückführen, und
> eine Lint-Regel verhindert, dass der Zustand diesem Modell entkommt.
