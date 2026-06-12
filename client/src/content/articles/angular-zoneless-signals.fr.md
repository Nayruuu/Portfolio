Pendant des années, Angular s'est appuyé sur **zone.js** pour savoir quand redéclencher le
change detection : un patch monkey de toutes les API asynchrones du navigateur. Ça marche,
mais c'est une boîte noire coûteuse. Depuis Angular 21, on peut s'en passer entièrement avec
`provideZonelessChangeDetection()` et laisser les **signals** piloter la réactivité.

## Pourquoi virer zone.js

zone.js intercepte `setTimeout`, les promesses, les events DOM, et déclenche un cycle de
détection **global** à chaque fois. Sur une grosse app, on vérifie des milliers de bindings
alors que trois ont changé. Le mode zoneless inverse la logique : **rien** ne se redessine
tant qu'un signal lu dans le template n'a pas notifié son changement.

- bundle plus léger : on supprime une dépendance de ~100 ko
- traces de pile lisibles : plus de frames `zone.run` partout
- détection ciblée : seuls les composants qui dépendent du signal modifié sont marqués

## Activer le mode zoneless

Tout se joue dans la configuration de l'application. On retire `provideZoneChangeDetection`
et on branche le provider zoneless :

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

### Penser en réactivité fine

Une fois zoneless, **tout l'état doit être un signal** sinon le template ne se met plus à
jour. On remplace les champs mutables par `signal()`, les valeurs dérivées par `computed()`,
et les effets de bord par `effect()` :

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

## Les pièges à connaître

Le code legacy qui fait `setTimeout(() => this.value = x)` **sans** passer par un signal ne
rafraîchira plus la vue. Idem pour les souscriptions RxJS : il faut soit `toSignal()`, soit
appeler `signal.set()` dans le `subscribe`. Côté tests, on bascule Vitest en zoneless et on
remplace les `fakeAsync`/`tick` par `await fixture.whenStable()`. La doc officielle détaille
chaque cas dans le [guide zoneless](https://angular.dev/guide/zoneless).

> Le zoneless ne rend pas une app magiquement plus rapide. Il rend la réactivité
> **explicite** : tu sais exactement pourquoi quelque chose se redessine, et c'est ça
> qui change tout en debug.
