On hérite rarement d'un **greenfield**. Le plus souvent, c'est un monolithe .NET qui tourne
en prod depuis huit ans, que personne n'ose toucher. Le pattern **Strangler Fig** permet
de le remplacer **morceau par morceau**, sans big-bang et sans fenêtre de coupure.

## Le principe

On place une façade devant le monolithe, puis on **réachemine** une route à la fois vers
un nouveau service. Tant qu'une fonctionnalité n'est pas réécrite, elle continue de passer
par l'ancien code. Le jour où la dernière route bascule, le monolithe est mort — étranglé.

### Une anti-corruption layer

Le nouveau code ne doit jamais parler le langage du legacy. On interpose une
**anti-corruption layer** qui traduit les modèles de l'ancien monde vers le nouveau :

```csharp
public sealed class LegacyOrderTranslator
{
    public Order ToDomain(LegacyOrderDto dto) => new(
        Id: new OrderId(dto.ORDER_ID),
        Total: Money.FromCents(dto.TOTAL_CENTS),
        PlacedAt: DateTime.SpecifyKind(dto.DT, DateTimeKind.Utc));
}
```

## Router au bon niveau

La bascule se fait idéalement au niveau du **reverse proxy** (YARP, Nginx) plutôt que dans
le code, pour garder les deux mondes parfaitement isolés. Avec [YARP](https://microsoft.github.io/reverse-proxy/),
une simple route de configuration suffit à dévier un chemin vers le nouveau service.

- une route migrée → nouveau service
- une route non migrée → monolithe
- un canary → 5 % du trafic, puis 100 %

## Mesurer avant de couper

Chaque route migrée est doublée d'un **shadow traffic** comparé à l'ancienne réponse avant
de couper pour de bon. On ne supprime l'ancien code que **mort prouvé** : tant qu'un appel
y transite encore, il reste. La télémétrie devient alors le juge de paix de la migration.

> Étrangler, ce n'est pas réécrire plus vite. C'est réécrire de façon **réversible** :
> à chaque étape, on peut revenir en arrière en une ligne de configuration.
