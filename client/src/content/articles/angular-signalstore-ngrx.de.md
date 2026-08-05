Diese Anwendung hat nur einen einzigen Store. Der gesamte übrige State lebt in lokalen `signal()`,
tief in den Komponenten, die sie besitzen. Der Store existiert nur für die eine Angabe, die keiner
einzelnen Komponente gehört: die aktive Sprache und der Content-Baum, den sie auflöst.

Diese Angabe wird überall gelesen (jeder Titel, jedes Label, jeder Breadcrumb greift darauf zu),
von Views abgeleitet, die auf ihrer Basis neu berechnen, und von zwei Stellen aus mutiert (dem
Route-Resolver und dem Start). Das ist die Stellenbeschreibung eines Stores. **NgRx SignalStore**
(`@ngrx/signals`) erfüllt sie ohne die Actions und Reducer des klassischen NgRx: schreibgeschützte
Signals als Ausgabe, Methoden als Eingabe.

## Features komponieren

Ein `signalStore` wird aus verketteten Features zusammengesetzt. `withState` deklariert die Form
und den initialen State, `withComputed` die abgeleiteten Werte, `withMethods` die Operationen.
Jedes State-Feld wird zu einem Signal, das auf der Instanz exponiert wird: die Deklaration von
`lang` erzeugt `store.lang`, ein `Signal<Lang>`, das jede beliebige Komponente lesen kann.

Der Content-Store hält drei Felder: `lang`, `content`, `loading`.

Der State wird nie direkt mutiert. Man geht über `patchState`, das ein unveränderliches Update
anwendet und nur die Signals benachrichtigt, deren Wert sich geändert hat. `loading` kann
umschalten, ohne dass irgendetwas neu gerendert wird, das von `content` abhängt.

Dieser Store nutzt kein `withComputed`. Seine abgeleiteten Werte (ein Seitentitel, ein Breadcrumb,
eine gefilterte Artikelliste) sind für jeden Screen eigen, also leben sie in den Komponenten, die
sie anzeigen, nicht im geteilten State. Die Regel, die sich daraus ergibt: nur zentralisieren, was
mehrere Views identisch ableiten.

## State in einem Injection-Kontext aufbauen

`withState` akzeptiert zwei Formen: ein Objektliteral oder eine Factory, die es zurückgibt. Die
Factory läuft im Injection-Kontext des Stores, was ihr erlaubt, per `inject()` einen Service zu
holen und beim Konstruieren `localStorage` zu lesen.

```typescript
export const ContentStore = signalStore(
  { providedIn: 'root' },
  withState<ContentState>(() => {
    const lang = readInitialLang();

    // Seed content synchronously so first paint + prerender already have the right locale.
    return { lang, content: inject(ContentApiService).peek(lang), loading: false };
  }),
  // withMethods / withHooks below
);
```

`readInitialLang` liest die persistierte Präferenz, validiert sie als `Lang` und fällt auf die
Standardsprache zurück, falls `localStorage` fehlt oder eine Exception wirft. Bewusst gibt es kein
Schnüffeln an `navigator.language`: Das native Prerendering und die Tests starten auf einer
deterministischen Sprache, nie auf der der Maschine, die baut. Das ist eine Entscheidung, die sich
anderswo bezahlt macht (ein erstes SSG-Rendering immer auf Französisch), hält aber die statische
Generierung reproduzierbar.

## Stale-while-revalidate, konkret

Der Store zeigt sofort einen bekannten Wert an und prüft dann im Hintergrund nach. Zwei Methoden
des Content-Service tragen diesen Vertrag.

`peek(lang)` liefert synchron den gecachten Wert zurück: sie ist es, die den State seedet, damit
das erste Rendering und die statische Generierung bereits Content haben. `getContent(lang)` macht
den asynchronen Fetch, den echten Netzwerk-Aufruf – irgendwann.

Heute ist dieser Service ein Mock über dem im Bundle eingebetteten Content. Es ist die einzige
Nahtstelle zwischen der App und der Frage „woher kommt der Content": Am Tag, an dem eine .NET-API
die Locales bedient, ist es die einzige Datei, die sich ändert.

```typescript
export const FETCH_DELAY_MS = 300;

public peek(lang: Lang): Content {
  return this.bundled[lang];
}

public getContent(lang: Lang): Promise<Content> {
  // Mock: a real client would fetch(this.contentUrl(lang)); we serve bundled content after a delay.
  return new Promise((resolve) => setTimeout(() => resolve(this.peek(lang)), FETCH_DELAY_MS));
}
```

Bei einem Sprachwechsel tauscht `setLang` zunächst den Content per `peek` aus (synchron, damit das
nächste Rendering bereits in der richtigen Locale ist) und startet dann die Revalidierung. Das Flag
`loading` wird für die Dauer des Fetch auf `true` gesetzt, was einer View erlaubt, während des
Umschaltens einen Ladezustand anzuzeigen.

Das Dictionary `bundled` ist als `Record<Lang, Content>` typisiert. Eine Sprache zum `LANG`-Wertesatz
hinzuzufügen kompiliert nicht mehr, solange ihr Bundle hier nicht angeschlossen ist. Der Compiler
hält die Liste aktuell.

## Ein veraltetes Ergebnis verwerfen

Sobald eine Methode asynchron ist, können sich zwei Aufrufe überlappen. Ein Besucher wechselt zu
Englisch, dann zu Deutsch, bevor Englisch zurückgekommen ist. Ohne Schutz würde das englische
Ergebnis zuletzt eintreffen und Deutsch überschreiben.

`reload` schützt sich mit einem Last-wins-Prinzip: bevor ein Ergebnis angewendet wird, prüft es,
ob die aktuelle Sprache noch die ist, die es angefragt hat.

```typescript
const reload = async (lang: Lang): Promise<void> => {
  patchState(store, { loading: true });
  const content = await api.getContent(lang);

  // Last-wins: a newer language switch has moved store.lang() on; drop this stale result.
  if (store.lang() === lang) {
    patchState(store, { content, loading: false });
  }
};
```

Ein Test verankert dieses Verhalten: Er startet ein `reload('en')`, während der Store bei `fr`
bleibt, lässt die simulierte Zeit um `FETCH_DELAY_MS` vorrücken und prüft, dass der endgültige
Content weiterhin `FR` ist. Das englische Ergebnis wird tatsächlich verworfen.

## Ein Effect innerhalb des Stores

`withHooks` gibt dem Store einen Lifecycle. Sein `onInit` läuft im Injection-Kontext des Stores,
was ihm erlaubt, einen `effect` zu öffnen.

```typescript
withHooks({
  onInit(store) {
    const doc = inject(DOCUMENT);

    // Revalidate the seeded content once at startup.
    void store.reload(store.lang());

    // Persist the language and reflect it on <html lang="…"> reactively.
    effect(() => {
      const lang = store.lang();

      try {
        localStorage.setItem(STORAGE_KEYS.LANG, lang);
      } catch {
        /* localStorage unavailable */
      }
      doc.documentElement.setAttribute('lang', lang);
    });
  },
});
```

Der Effect hängt von `store.lang()` ab. Bei jeder Änderung persistiert er die Präferenz neu und
aktualisiert das `lang`-Attribut von `<html>`, jenes, das Screenreader und Suchmaschinen lesen.
Das `localStorage`-Schreiben ist in ein `try` eingehüllt, das den Fehler schluckt: ein volles
Kontingent darf das Rendering nicht zum Absturz bringen. Ein Test prüft das, indem er `setItem`
werfen lässt, sicherstellt, dass der `tick` nicht wirft, und dass `<html lang>` trotzdem aktuell
bleibt.

Da der Effect im Kontext des Stores entsteht, wird er mit ihm zusammen aufgeräumt. Kein
`Subscription`, das man von Hand auflösen müsste.

## Eine Fassade über dem Store

Keine Komponente injiziert `ContentStore` direkt. Sie gehen über `I18nService`, eine Fassade, die
nur vier Dinge reexponiert: `lang`, `content`, `loading`, `setLang`.

```typescript
@Injectable({ providedIn: 'root' })
export class I18nService {
  public readonly lang: Signal<Lang>;
  public readonly content: Signal<Content>;
  public readonly loading: Signal<boolean>;

  private readonly store = inject(ContentStore);

  constructor() {
    this.lang = this.store.lang;
    this.content = this.store.content;
    this.loading = this.store.loading;
  }

  public setLang(lang: Lang): void {
    this.store.setLang(lang);
  }
}
```

Die Oberfläche ist stabil. Gewinnt der Store ein internes Feld hinzu oder ändert seine
Feature-Komposition, bewegen sich die Dutzenden Komponenten, die die Sprache lesen, nicht. Sie
hängen von einem Vertrag ab, nicht von einer Form.

Der Sprachwechsel wird über die URL ausgelöst, nie über einen direkten Aufruf. Der Sprachwähler
navigiert zur selben Seite mit einem anderen Präfix (`/fr`, `/en`, …). Es ist der Route-Resolver,
der `setLang` anhand dieses Präfixes aufruft, bevor die Komponente rendert. Die URL bleibt die
einzige Wahrheitsquelle für die Sprache: ein geteilter Link zu `/de/articles` öffnet die Seite auf
Deutsch, ohne dass irgendein State von Hand synchronisiert werden müsste.

## Die Schwelle des Stores

Nicht alles braucht einen Store, und diese App zeigt es, indem sie nur einen einzigen hat. Ein
aktiver Tab, das Öffnen eines Menüs: das bleibt ein privates `signal()` in der Komponente. Dort
einen Store hinzuzufügen, würde nur Indirektion bringen.

Der SignalStore rechtfertigt sich, wenn der State die Kästchen ankreuzt, die die Sprache hier
ankreuzt: geteilt über mehrere Screens, von Views abgeleitet, die auf seiner Basis neu berechnen,
mutiert durch Operationen, die man einzeln testen möchte. Das Last-wins-Prinzip, die Persistierung,
der synchrone Seed – jedes lässt sich isoliert testen, ohne eine Komponente zu mounten.

In der Praxis: mit lokalen Signals anfangen, einen Store extrahieren an dem Tag, an dem man denselben
State in eine zweite Komponente kopieren würde. Der [SignalStore-Guide](https://ngrx.io/guide/signals/signal-store)
beschreibt jedes Feature im Detail, `rxMethod` eingeschlossen (das dieser Store nicht nutzt: ein
`async`/`await` genügte, um einen einzelnen Fetch zu orchestrieren).

> Ein SignalStore ist eine Fassade aus Signals: schreibgeschützt als Ausgabe, Methoden als Eingabe,
> null Reducer. Man behält die Disziplin eines Stores und dessen Lifecycle, aber ohne das
> Zeremoniell der Actions von gestrigem NgRx.
