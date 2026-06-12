## Por qué deshacerse de zone.js

zone.js intercepta `setTimeout`, las promesas, los eventos del DOM y desencadena un ciclo de
detección **global** cada vez. En una app grande, se verifican miles de bindings cuando solo
tres han cambiado. El modo zoneless invierte la lógica: **nada** se vuelve a pintar mientras
un signal leído en el template no haya notificado su cambio.

- bundle más ligero: se elimina una dependencia de ~100 ko
- trazas de pila legibles: sin más frames de `zone.run` por todas partes
- detección dirigida: solo los componentes que dependen del signal modificado son marcados

## Activar el modo zoneless

Todo ocurre en la configuración de la aplicación. Se elimina `provideZoneChangeDetection`
y se conecta el provider zoneless:

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

### Pensar en reactividad fina

Una vez en modo zoneless, **todo el estado debe ser un signal**, de lo contrario el template
deja de actualizarse. Se reemplazan los campos mutables por `signal()`, los valores derivados
por `computed()`, y los efectos secundarios por `effect()`:

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

## Las trampas que hay que conocer

El código legacy que hace `setTimeout(() => this.value = x)` **sin** pasar por un signal ya
no refrescará la vista. Lo mismo ocurre con las suscripciones RxJS: hay que usar `toSignal()` o
llamar a `signal.set()` dentro del `subscribe`. En cuanto a los tests, se cambia Vitest a modo
zoneless y se reemplazan los `fakeAsync`/`tick` por `await fixture.whenStable()`. La documentación
oficial detalla cada caso en la [guide zoneless](https://angular.dev/guide/zoneless).

> El zoneless no hace que una app sea mágicamente más rápida. Hace que la reactividad sea
> **explícita**: sabes exactamente por qué algo se vuelve a pintar, y eso es lo que lo cambia
> todo al depurar.
