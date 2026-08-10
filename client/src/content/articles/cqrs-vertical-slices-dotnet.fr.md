Beaucoup d'équipes rangent **CQRS** dans le même tiroir que l'event sourcing, les bus de
messages et les bases de données dupliquées. L'idée de départ est pourtant modeste : séparer le
chemin des lectures de celui des écritures. On l'applique sans infrastructure supplémentaire, en
organisant le code par **vertical slices**, une fonctionnalité par dossier.

## Découper par fonctionnalité, pas par couche

L'architecture en couches éclate une fonctionnalité dans cinq dossiers : `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. Pour suivre « créer une commande » de bout en
bout, on saute de fichier en fichier, et chaque dossier finit par mélanger des morceaux de
dizaines de fonctionnalités sans rapport.

La **vertical slice** inverse le rangement : un dossier par cas d'usage, tout ce qui le concerne
au même endroit.

```bash
Features/
  Orders/
    CreateOrder.cs      # command + handler + validator
    GetOrderById.cs     # query + handler
    ListOrders.cs
```

Un slice contient sa requête, son handler, le validateur qui va avec et le DTO qu'il renvoie. Il
se lit de haut en bas et se supprime sans effet de bord : rien d'autre ne dépend de lui. Deux
slices ne partagent que le **domaine**, jamais un « service » fourre-tout dans lequel toute
l'application vient piocher. Jimmy Bogard, qui a popularisé l'approche sous le nom de
[vertical slice architecture](https://www.jimmybogard.com/vertical-slice-architecture/), en donne
la contrainte tenante : ce qui change ensemble vit ensemble.

## Commande et requête, deux intentions distinctes

Une **commande** modifie l'état et ne renvoie idéalement qu'un identifiant, ou rien. Une
**requête** ne lit que ce dont la vue a besoin et ne touche à rien. Les modéliser comme deux
types séparés rend l'intention lisible dès la signature.

La distinction n'est pas neuve. Elle prolonge le principe de **Command-Query Separation** de
Bertrand Meyer, où une méthode change l'état ou renvoie une valeur, jamais les deux. Greg Young
en a fait un sigle, CQRS, en poussant l'idée à l'échelle d'un modèle entier plutôt que d'une
méthode.

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
`Order.Create`, où l'agrégat protège ses invariants. Si elle migre dans le handler, on a juste
renommé le « service » qu'on voulait fuir.

Un handler aussi plat se teste sans cérémonie : il reçoit ses dépendances en paramètres, on
l'instancie avec un `AppDbContext` sur SQLite ou le provider in-memory, on appelle `Handle`, on
inspecte le retour. Pas de serveur HTTP à monter, pas de pipeline à simuler.

## Deux modèles de données pour deux besoins

C'est côté lecture que la séparation paie, même avec une seule base. Le côté écriture passe par
l'agrégat parce qu'il doit valider des règles avant de muter l'état. Le côté lecture n'a aucune
raison de reconstruire cet agrégat : il projette directement la table vers le DTO attendu par
l'appelant.

```csharp
public sealed record GetOrderSummary(Guid OrderId) : IRequest<OrderSummary?>;

public sealed record OrderSummary(Guid Id, string Customer, decimal Total, int LineCount);

public sealed class GetOrderSummaryHandler(AppDbContext db)
    : IRequestHandler<GetOrderSummary, OrderSummary?>
{
    public Task<OrderSummary?> Handle(GetOrderSummary query, CancellationToken ct) =>
        db.Orders
            .AsNoTracking()
            .Where(o => o.Id == query.OrderId)
            .Select(o => new OrderSummary(
                o.Id,
                o.Customer.Name,
                o.Lines.Sum(l => l.Quantity * l.UnitPrice),
                o.Lines.Count))
            .SingleOrDefaultAsync(ct);
}
```

`AsNoTracking` coupe le change tracker, inutile pour une lecture, et le `Select` laisse EF Core
générer un `SELECT` qui ne ramène que les colonnes projetées. La requête n'est plus prisonnière
de la forme du modèle d'écriture : elle assemble exactement la vue voulue, sommes et jointures
comprises.

Le jour où les lectures deviennent le goulot d'étranglement, ce même slice devient le point
d'accroche pour brancher du Dapper, du SQL brut ou une table dénormalisée, sans toucher au côté
écriture. Rien n'oblige à le faire tant qu'une métrique ne l'exige pas.

## Le médiateur, un détail d'implémentation

CQRS arrive souvent collé à [MediatR](https://github.com/jbogard/MediatR). Le médiateur découple
l'endpoint du handler et offre un point d'accroche pour les **pipeline behaviors**. Un endpoint
se contente alors d'envoyer le message : `await sender.Send(command)` renvoie l'identifiant, que
l'on emballe dans un `TypedResults.Created`.

Pratique, mais à part : rien dans CQRS n'impose un médiateur. On peut injecter le handler
directement dans l'endpoint et l'appeler à la main. MediatR est d'ailleurs passé sous licence
commerciale, ce qui rend l'option maison plus sérieuse qu'avant : un dispatcher qui résout
`IRequestHandler<,>` dans le conteneur et appelle `Handle` tient en une quinzaine de lignes. Sur
une petite application, cette indirection en moins vaut souvent le geste.

L'endpoint lui-même peut vivre dans le fichier du slice, exposé par une méthode d'extension
`MapCreateOrder` que le `Program.cs` se contente d'appeler comme un `MapGroup`. La route, la
commande et le handler tiennent alors dans le même fichier, et rien de la fonctionnalité ne
traîne ailleurs.

## Où placer la validation et le transverse

Validation, journalisation, ouverture de transaction : ces préoccupations reviennent dans chaque
slice. Les recopier dans chaque handler est la meilleure façon d'en oublier une. Un **pipeline
behavior** les factorise en enveloppant tous les handlers d'un coup.

```csharp
public sealed class ValidationBehavior<TRequest, TResponse>(
    IEnumerable<IValidator<TRequest>> validators)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken ct)
    {
        var context = new ValidationContext<TRequest>(request);
        var failures = validators
            .Select(v => v.Validate(context))
            .SelectMany(result => result.Errors)
            .ToList();

        if (failures.Count != 0)
        {
            throw new ValidationException(failures);
        }

        return await next();
    }
}
```

Chaque slice déclare son [validateur FluentValidation](https://docs.fluentvalidation.net/), le
behavior le récupère par injection et le déclenche avant le handler. Enregistré une fois via
`AddOpenBehavior(typeof(ValidationBehavior<,>))`, il couvre commandes et requêtes sans code
répété.

Le behavior a un coût : c'est du flux de contrôle invisible. Il en faut peu, chacun clairement
borné, sinon on recrée la magie qu'on reprochait au médiateur.

## Ne pas sur-concevoir

La question à poser devant chaque slice reste la même : **en ai-je vraiment besoin ?** Bases
séparées, projections asynchrones, event sourcing répondent à des problèmes précis : lectures
massivement supérieures aux écritures, audit immuable, modèle de lecture très éloigné du modèle
d'écriture. En l'absence de ce problème, ils n'ajoutent que de la latence et des bugs de
cohérence à retardement.

Le CQRS utile, dans l'immense majorité des cas : des commandes et des requêtes distinctes, un
seul `DbContext`, des slices qu'on lit sans grep. Le reste attend une raison chiffrée.

> CQRS commence par une discipline de nommage avant d'être une architecture. Séparez les
> intentions, gardez les handlers minces, laissez les lectures court-circuiter le domaine, et
> n'ajoutez un bus de messages que le jour où une mesure vous y oblige.
