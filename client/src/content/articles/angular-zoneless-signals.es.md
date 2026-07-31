Durante años, Angular se ha apoyado en **zone.js** para saber cuándo volver a disparar el
change detection: un monkey-patch de todas las API asíncronas del navegador. Funciona,
pero es una caja negra costosa. Desde Angular 21, se puede prescindir de ella por completo con
`provideZonelessChangeDetection()` y dejar que las **signals** piloten la reactividad.

## Por qué eliminar zone.js

zone.js intercepta `setTimeout`, las promesas, los eventos DOM, y dispara un ciclo de
detección **global** cada vez. En una app grande, se verifican miles de bindings
cuando solo tres han cambiado. El modo zoneless invierte la lógica: **nada** se vuelve a renderizar
mientras un signal leído en el template no haya notificado su cambio.

De paso, el bundle pierde una dependencia de ~100 kB. Los stack traces vuelven a ser
legibles, sin frames `zone.run` intercalados en cada nivel. Y la detección se vuelve
específica: solo se marcan los componentes que dependen del signal modificado.

## Activar el modo zoneless

La activación se hace en la configuración de la aplicación. Se retira
`provideZoneChangeDetection` y se conecta el provider zoneless:

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

Una vez en zoneless, **todo el estado debe ser un signal**, o el template ya no se
actualizará. Se reemplazan los campos mutables por `signal()`, los valores derivados por `computed()`,
y los efectos secundarios por `effect()`:

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

## Las trampas a conocer

El código legacy que hace `setTimeout(() => this.value = x)` **sin** pasar por un signal ya no
refrescará la vista. Lo mismo para las suscripciones RxJS: hay que usar `toSignal()`, o bien
llamar a `signal.set()` dentro del `subscribe`.

En cuanto a los tests, se cambia Vitest a zoneless y se reemplazan los `fakeAsync`/`tick` por
`await fixture.whenStable()`. La documentación oficial detalla cada caso en la
[guía zoneless](https://angular.dev/guide/zoneless).

> El zoneless no acelera una app por arte de magia. La ganancia se ve al depurar: la reactividad
> se ha vuelto **explícita**, y se sabe exactamente qué signal provocó cada redibujado
> de la vista.
