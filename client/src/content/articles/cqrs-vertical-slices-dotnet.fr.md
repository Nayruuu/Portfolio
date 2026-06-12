Dès qu'on prononce **CQRS**, beaucoup d'équipes sortent l'artillerie lourde : event sourcing,
bus de messages, deux bases de données. Pourtant CQRS, c'est d'abord une idée modeste —
**séparer les lectures des écritures** — qu'on peut appliquer sans aucune usine à gaz, en
organisant le code par **vertical slices**.

## Découper par fonctionnalité, pas par couche

L'architecture en couches éclate une fonctionnalité dans cinq dossiers : `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. Pour comprendre « créer une commande », on
saute de fichier en fichier. La **vertical slice** inverse la logique : un dossier par
fonctionnalité, tout ce qui la concerne au même endroit.

```bash
Features/
  Orders/
    CreateOrder.cs      # commande + handler + validateur
    GetOrderById.cs     # requête + handler
    ListOrders.cs
```

Chaque slice est autonome. On la lit de haut en bas, on la supprime sans effet de bord, et
deux slices ne partagent que le domaine — jamais un « service » fourre-tout.

## Commande et requête, deux intentions distinctes

Une **commande** modifie l'état et ne renvoie (idéalement) qu'un identifiant. Une **requête**
ne lit rien d'autre que ce dont la vue a besoin, souvent en court-circuitant le domaine pour
projeter directement vers un DTO. Les modéliser séparément clarifie l'intention :

```csharp
public sealed record CreateOrder(Guid CustomerId, IReadOnlyList<LineItem> Items)
    : IRequest<Guid>;

public sealed class CreateOrderHandler(AppDbContext db)
    : IRequestHandler<CreateOrder, Guid>
{
    public async Task<Guid> Handle(CreateOrder command, CancellationToken ct)
    {
        var order = Order.Create(command.CustomerId, command.Items);
        db.Orders.Add(order);
        await db.SaveChangesAsync(ct);

        return order.Id;
    }
}
```

Le handler reste **mince** : il orchestre, il ne raisonne pas. La logique métier vit dans
`Order.Create`, pas dans le handler — sinon on a juste déplacé le « service » dans un autre
fichier.

## Le médiateur, optionnel

On voit souvent CQRS collé à [MediatR](https://github.com/jbogard/MediatR). Le médiateur
découple l'endpoint du handler et offre un point d'accroche pour les **pipeline behaviors**
(validation, logging, transaction). C'est pratique, mais ce n'est **pas** CQRS : on peut très
bien injecter le handler directement.

```csharp
group.MapPost("/", async (CreateOrder command, ISender sender) =>
{
    var id = await sender.Send(command);

    return TypedResults.Created($"/orders/{id}", new { id });
});
```

Si l'application est petite, sauter le médiateur et appeler le handler à la main reste
parfaitement légitime — moins d'indirection, moins de magie.

## Ne pas sur-concevoir

La question à se poser à chaque slice : **ai-je vraiment besoin de ça ?** Bases séparées,
projections asynchrones, event sourcing — ce sont des réponses à des problèmes d'échelle
précis (lectures massivement supérieures aux écritures, audit immuable). Sans ce problème,
ils n'ajoutent que de la latence et des bugs de cohérence. Le bon CQRS, dans 90 % des cas,
c'est : commandes et requêtes distinctes, un seul `DbContext`, des slices lisibles.

> CQRS n'est pas une architecture, c'est une **discipline de nommage**. Séparez les
> intentions, gardez les handlers minces, et n'ajoutez un bus de messages que le jour où une
> métrique vous y force.
