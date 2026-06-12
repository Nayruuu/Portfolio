## Warum zone.js abschaffen

zone.js fängt `setTimeout`, Promises, DOM-Events ab und löst bei jedem Ereignis einen
**globalen** Erkennungszyklus aus. In einer großen App werden dabei Tausende von Bindings
geprüft, obwohl sich nur drei geändert haben. Der zoneless-Modus kehrt die Logik um: **nichts**
wird neu gerendert, solange kein im Template gelesenes Signal seine Änderung gemeldet hat.

- Kleineres Bundle: eine Abhängigkeit von ~100 kb entfällt
- Lesbare Stack-Traces: keine `zone.run`-Frames mehr überall
- Gezielte Erkennung: nur Komponenten, die vom geänderten Signal abhängen, werden markiert

## Den zoneless-Modus aktivieren

Alles spielt sich in der Anwendungskonfiguration ab. Man entfernt `provideZoneChangeDetection`
und hängt den zoneless-Provider ein:

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

Im zoneless-Modus **muss der gesamte Zustand ein Signal sein**, sonst aktualisiert sich das
Template nicht mehr. Man ersetzt veränderliche Felder durch `signal()`, abgeleitete Werte durch
`computed()` und Seiteneffekte durch `effect()`:

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

## Die Fallstricke kennen

Legacy-Code, der `setTimeout(() => this.value = x)` ausführt, **ohne** ein Signal zu
verwenden, aktualisiert die View nicht mehr. Gleiches gilt für RxJS-Subscriptions: man braucht
entweder `toSignal()` oder muss `signal.set()` im `subscribe` aufrufen. Bei Tests wechselt man
Vitest auf zoneless und ersetzt `fakeAsync`/`tick` durch `await fixture.whenStable()`. Die
offizielle Dokumentation beschreibt jeden Fall im Detail im [guide zoneless](https://angular.dev/guide/zoneless).

> Zoneless macht eine App nicht magisch schneller. Es macht Reaktivität
> **explizit**: man weiß genau, warum etwas neu gerendert wird — und genau das
> verändert alles beim Debugging.
