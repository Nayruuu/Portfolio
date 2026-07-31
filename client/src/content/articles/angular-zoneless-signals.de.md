Jahrelang hat sich Angular auf **zone.js** verlassen, um zu wissen, wann die Change Detection
erneut angestoßen werden muss: ein Monkey-Patch aller asynchronen APIs des Browsers. Das
funktioniert, ist aber eine teure Blackbox. Seit Angular 21 kann man mit
`provideZonelessChangeDetection()` vollständig darauf verzichten und die **Signals** die
Reaktivität steuern lassen.

## Warum zone.js loswerden

zone.js fängt `setTimeout`, Promises und DOM-Events ab und löst jedes Mal einen **globalen**
Detection-Zyklus aus. In einer großen App prüft man Tausende Bindings, obwohl sich nur drei
geändert haben. Der Zoneless-Modus kehrt die Logik um: **nichts** wird neu gezeichnet,
solange ein im Template gelesenes Signal seine Änderung nicht gemeldet hat.

Nebenbei verliert das Bundle eine Abhängigkeit von ~100 kB. Stack-Traces werden wieder
lesbar, ohne `zone.run`-Frames auf jeder Ebene. Und die Detection wird gezielt: Markiert
werden nur die Komponenten, die vom geänderten Signal abhängen.

## Den Zoneless-Modus aktivieren

Die Aktivierung erfolgt in der Anwendungskonfiguration. Man entfernt
`provideZoneChangeDetection` und bindet den Zoneless-Provider ein:

```typescript
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
  ],
});
```

### In feingranularer Reaktivität denken

Sobald die App zoneless läuft, **muss der gesamte State ein Signal sein**, sonst
aktualisiert sich das Template nicht mehr. Man ersetzt veränderliche Felder durch
`signal()`, abgeleitete Werte durch `computed()` und Seiteneffekte durch `effect()`:

```typescript
@Component({
  selector: 'app-cart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `Total : {{ total() }} €`,
})
export class CartComponent {
  protected readonly items = signal<CartItem[]>([]);
  protected readonly total = computed(() =>
    this.items().reduce((sum, item) => sum + item.price * item.quantity, 0),
  );
}
```

## Die Fallstricke, die man kennen sollte

Legacy-Code, der `setTimeout(() => this.value = x)` macht, **ohne** über ein Signal zu
gehen, aktualisiert die View nicht mehr. Dasselbe gilt für RxJS-Subscriptions: Man muss
entweder `toSignal()` verwenden oder im `subscribe` ein `signal.set()` aufrufen.

Bei den Tests stellt man Vitest auf zoneless um und ersetzt `fakeAsync`/`tick` durch
`await fixture.whenStable()`. Die offizielle Dokumentation behandelt jeden Fall im
[Zoneless-Guide](https://angular.dev/guide/zoneless).

> Zoneless macht eine App nicht auf magische Weise schneller. Der Gewinn zeigt sich beim
> Debuggen: Die Reaktivität ist **explizit** geworden, und man weiß genau, welches Signal
> jedes Neuzeichnen der View ausgelöst hat.
