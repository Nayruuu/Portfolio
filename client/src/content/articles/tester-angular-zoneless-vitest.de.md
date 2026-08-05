Wenn eine Angular-App auf zoneless umgestellt wird, verschwindet `zone.js` – und mit ihm das
implizite Signal, das mitteilte: „die View ist stabil, du kannst das DOM inspizieren". Der
Vertrag der Tests ändert sich: Statt darauf zu warten, dass eine Zone von selbst verstummt,
fordert jeder Test die Stabilität genau in dem Moment ein, in dem er sie braucht.

Dieses Portfolio läuft genau so. 104 `.spec.ts`-Dateien, über tausend Testfälle, kein
`fakeAsync`, kein manuelles `detectChanges()`. Hier sind die Patterns, die die Suite tragen, und
die Fallstricke, die dazugehören.

## Der Zoneless-Modus, ein für alle Mal

Seit Angular 21 bringt der Builder `@angular/build:unit-test` **Vitest** mit: Der Runner und
seine Optionen leben in `angular.json`, nicht in einer separaten `vitest.config.ts`. Ein
einziger Schlüssel zählt für die gesamte Suite, `providersFile`, der die Provider bestimmt, die
in die Testumgebung jedes Tests injiziert werden.

Diese Datei aktiviert den Zoneless-Modus (`provideZonelessChangeDetection`) ein für alle Mal:

```typescript
// src/test-providers.ts: injected into every test's environment
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

export default [provideZonelessChangeDetection(), provideRouter([])];
```

Das `provideRouter([])` mit leeren Routen erspart es, in jedem `beforeEach` einen Router neu zu
konfigurieren: Komponenten, die `routerLink` verwenden, werden ohne Umstände gemountet, und die
eigentliche Navigation bleibt durch die Playwright-Tests abgedeckt. Der
[Angular-Test-Guide](https://angular.dev/guide/testing) folgt demselben Prinzip: die reale
Komponente mounten und dann prüfen, was sie rendert.

## Eine Komponente über ihre Signal-Inputs steuern

Ein `input()`-Signal ist von außen betrachtet nur lesbar. Man weist die Property nicht neu zu:
Man geht über `fixture.componentRef.setInput()` und wartet dann, bis sich der Wert bis ins
Rendering fortpflanzt, mit `await fixture.whenStable()`.

```typescript
beforeEach(async () => {
  await TestBed.configureTestingModule({ imports: [CodeBlockComponent] }).compileComponents();
  fixture = TestBed.createComponent(CodeBlockComponent);
  fixture.componentRef.setInput('code', 'const answer = 42;');
  fixture.componentRef.setInput('lang', 'typescript');
});

it('renders the provided code', async () => {
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('answer');
});
```

Kein `detectChanges()`: In der gesamten Suite steht der Zähler bei null. Das Rendering wird
ausgelöst, weil die Komponente auf ihre Signale reagiert, und `whenStable()` gibt die Kontrolle
zurück, sobald sich die Change Detection beruhigt hat.

Die `Typed`-Komponente des Players treibt das Verfahren noch weiter. Ihre Ausgabe ist eine reine
Funktion dreier Inputs (`elapsed`, `at`, `text`); der Test legt alle drei Werte fest, wartet auf
Stabilität und prüft den angezeigten Text Buchstabe für Buchstabe. Bei 40 Zeichen pro Sekunde
ergibt `elapsed = 1.05` mit `at = 1` genau zwei sichtbare Buchstaben. Die Zeitsteuerung wird zu
einer deterministischen Assertion, ohne eine Uhr, die man austricksen müsste.

## whenStable, und worauf es wirklich wartet

`whenStable()` ersetzt `fakeAsync`/`tick()` für gewöhnliche Asynchronität, aber man muss wissen,
worauf es wartet: dass die Anwendung wieder stabil wird. Eine noch laufende Task hält sie
beschäftigt, und das Promise löst sich nie auf.

Der konkrete Fall stammt von der Artikelseite. Ihre Vote-Bar löst beim Mounten ein `GET` an die
API aus; bleibt das so, lässt dieser hängende Fetch `whenStable()` ins Leere laufen. Der Test
kappt die Abhängigkeit:

```typescript
// The like-bar fetches its tally on render; stub the API so the pending HTTP GET
// can't leave whenStable() hanging.
const feedback: Pick<FeedbackApiService, 'count' | 'cast'> = {
  count: () => Promise.resolve({ up: 0, down: 0, mine: null }),
  cast: () => Promise.resolve({ up: 0, down: 0, mine: null }),
};
```

Der Stub liefert bereits aufgelöste Promises: kein wartender Request mehr, `whenStable()`
schließt ab, und die eigentliche Zählung bleibt auf ihrer eigenen Ebene in
`like-bar.component.spec.ts` getestet. Die allgemeine Regel: Alles, was die App beschäftigt hält
(ein Timer, ein Request, eine Mikrotask), muss beherrscht werden, sonst wendet sich das
explizite Warten gegen den Test.

## Timer laufen nicht über die Stabilität

Ein `setInterval` ist keine Task, die `whenStable()` abfließen lassen kann: Er läuft, solange
man ihn nicht stoppt. Für diese Fälle behält man die Fake-Timer von Vitest bei.

`PlayerService` ist das Beispiel dafür im Repo. Seine Wiedergabeschleife lebt in einem `effect`,
das das Signal `playing` liest: Bei der Aktivierung plant der Effect ein `setInterval`, das die
Zeit alle 100 ms um `0.1 × rate` vorrückt; beim Stopp gibt ein `onCleanup` das Intervall frei.
Genau das ist die Art von Code, bei der ein vergessenes Cleanup einen Timer leckt und den
nächsten Test verfälscht.

Der Test muss zunächst den Effect auslösen, was `appRef.tick()` erledigt, und dann die
simulierte Uhr vorstellen. Anschließend prüft er, dass die Pause tatsächlich das `onCleanup`
ausführt:

```typescript
it('the tick advances time while playing, and onCleanup stops it on pause', () => {
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

`appRef.tick()` ist die Geste, die das alte `detectChanges()` ersetzt: Sie bringt Angular dazu,
seine Effects laufen zu lassen. Der Rest ist Standard-Vitest, `vi.advanceTimersByTime()` dort,
wo man früher `tick()` geschrieben hätte, plus ein `afterEach(() => vi.useRealTimers())`, um den
folgenden Testfall nicht zu kontaminieren.

## Die meisten Tests mounten keine einzige Komponente

Von den 104 Dateien der Suite importieren 73 nicht einmal `TestBed`. Eine reine Funktion oder
ein `computed()` wird direkt aufgerufen, ohne Fixture, ohne DOM, ohne Warten: Der Test ist
sofort abgeschlossen.

`truncateAtWord`, das eine Bio an der letzten Wortgrenze kürzt, wird mit Eingaben und Ausgaben
geprüft, nichts weiter:
`truncateAtWord('Full-stack developer building serious things', 20)` muss
`'Full-stack developer'` ergeben, und ein einzelnes Wort, das länger als das Limit ist, wird
hart abgeschnitten. `TestBed` bleibt dem Rendering eines echten Templates vorbehalten; alles,
was Logik ist, wird ohne ihn getestet, und das ist der Großteil des Codes.

## Der Schutzwall: core/ zu 100 %

Die globalen Coverage-Schwellenwerte in `angular.json` liegen bewusst unter 100 % (statements
85, branches 78, functions 67, lines 88). Sie umfassen die UI-Komponenten und den
Browser-Host des Spiels, sein Canvas und seine Worker, die man nicht bis auf die Zeile genau
abdecken will; diese Dateien sind zudem über `coverageExclude` aus dem Report herausgenommen.

Der logische Kern hingegen muss vollständig bleiben. Der Builder kann keinen Schwellenwert pro
Ordner erzwingen, also übernimmt das im Nachhinein ein kleines Skript. `check-core-coverage.mjs`
liest die Zusammenfassung des `json-summary`-Reporters, durchläuft jede Datei und schlägt fehl
(`exit 1`), sobald eine Datei aus `core/` (außer `.spec.ts`) bei einer der vier Metriken unter
100 % fällt.

Da die Rendering-Adapter des Spiels nicht im Report auftauchen, greift die 100-%-Regel exakt auf
die reine Logik, die übrig bleibt. Das Coverage-Skript reiht die beiden Schritte aneinander:
`ng test --coverage && node scripts/check-core-coverage.mjs`. Eine `core/`-Datei unter 100 %
bricht den Befehl ab, nicht nur eine Log-Zeile, die man am Ende ignoriert.

> Ohne `zone.js` kann ein Test nicht mehr davon ausgehen, dass die View bereit ist: Er muss es
> einfordern. Das ist etwas mehr Code pro Testfall, und im Gegenzug bedeutet ein grüner Test
> tatsächlich das, was er behauptet – Timer und Requests eingeschlossen.
