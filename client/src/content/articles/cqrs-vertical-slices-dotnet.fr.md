Beaucoup d'équipes associent **CQRS** à l'event sourcing, aux bus de messages, aux bases de
données séparées. L'idée de départ est pourtant modeste : **séparer les lectures des
écritures**. Elle s'applique sans usine à gaz, en organisant le code par **vertical slices**.

## Découper par fonctionnalité, pas par couche

L'architecture en couches éclate une fonctionnalité dans cinq dossiers : `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. Pour comprendre « créer une commande », on
saute de fichier en fichier. La **vertical slice** inverse la logique : un dossier par
fonctionnalité, tout ce qui la concerne au même endroit.

```bash
Features/
  Orders/
    CreateOrder.cs      # command + handler + validator
    GetOrderById.cs     # query + handler
    ListOrders.cs
```

Chaque slice est autonome : elle se lit de haut en bas et se supprime sans effet de bord.
Deux slices ne partagent que le domaine, jamais un « service » fourre-tout.

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

Le handler reste **mince** : il orchestre, sans raisonner. La logique métier vit dans
`Order.Create`, pas dans le handler. Sinon on a juste déplacé le « service » dans un autre
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
légitime : on retire une couche d'indirection et la magie qui va avec.

## Ne pas sur-concevoir

La question à se poser à chaque slice : **ai-je vraiment besoin de ça ?** Bases séparées,
projections asynchrones, event sourcing répondent à des problèmes d'échelle précis (lectures
massivement supérieures aux écritures, audit immuable). Sans ce problème, ils n'ajoutent que
de la latence et des bugs de cohérence.

Le bon CQRS, dans 90 % des cas : des commandes et des requêtes distinctes, un seul
`DbContext`, des slices lisibles.

> CQRS est une **discipline de nommage** avant d'être une architecture. Séparez les
> intentions, gardez les handlers minces, et n'ajoutez un bus de messages que le jour où une
> métrique vous y force.
