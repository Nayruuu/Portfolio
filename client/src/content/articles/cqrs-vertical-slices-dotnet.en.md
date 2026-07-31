Many teams associate **CQRS** with event sourcing, message buses, separate databases. Yet the
original idea is modest: **separate reads from writes**. It applies without over-engineering,
by organizing code into **vertical slices**.

## Split by feature, not by layer

Layered architecture scatters a feature across five folders: `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. To understand "create an order," you
jump from file to file. The **vertical slice** flips the logic: one folder per
feature, everything related to it in the same place.

```bash
Features/
  Orders/
    CreateOrder.cs      # command + handler + validator
    GetOrderById.cs     # query + handler
    ListOrders.cs
```

Each slice is self-contained: it reads top to bottom and can be deleted without side effects.
Two slices share only the domain, never a catch-all "service."

## Command and query, two distinct intentions

A **command** changes state and (ideally) returns only an identifier. A **query**
reads nothing beyond what the view needs, often bypassing the domain to
project directly into a DTO. Modeling them separately clarifies intent:

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

The handler stays **thin**: it orchestrates, without reasoning. The business logic lives in
`Order.Create`, not in the handler. Otherwise you've just moved the "service" into another
file.

## The mediator, optional

CQRS is often seen glued to [MediatR](https://github.com/jbogard/MediatR). The mediator
decouples the endpoint from the handler and offers a hook point for **pipeline behaviors**
(validation, logging, transaction). It's convenient, but it's **not** CQRS: you can perfectly
well inject the handler directly.

```csharp
group.MapPost("/", async (CreateOrder command, ISender sender) =>
{
    var id = await sender.Send(command);

    return TypedResults.Created($"/orders/{id}", new { id });
});
```

If the application is small, skipping the mediator and calling the handler by hand remains
legitimate: you remove a layer of indirection and the magic that comes with it.

## Don't over-engineer

The question to ask for every slice: **do I really need this?** Separate databases,
asynchronous projections, event sourcing address specific scale problems (reads
massively outnumbering writes, immutable audit trails). Without that problem, they only add
latency and consistency bugs.

Good CQRS, in 90% of cases: distinct commands and queries, a single
`DbContext`, readable slices.

> CQRS is a **naming discipline** before it's an architecture. Separate the
> intentions, keep the handlers thin, and only add a message bus the day a
> metric forces you to.
