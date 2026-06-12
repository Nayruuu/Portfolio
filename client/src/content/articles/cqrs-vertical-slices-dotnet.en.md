The moment someone says **CQRS**, many teams roll out the heavy artillery: event sourcing,
a message bus, two databases. Yet CQRS starts as a modest idea — **separate reads from
writes** — that you can apply without any ceremony at all, by organizing code into
**vertical slices**.

## Slice by feature, not by layer

Layered architecture scatters a single feature across five folders: `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. To understand "create an order" you hop
from file to file. The **vertical slice** flips it: one folder per feature, everything it
touches in one place.

```bash
Features/
  Orders/
    CreateOrder.cs      # command + handler + validator
    GetOrderById.cs     # query + handler
    ListOrders.cs
```

Each slice is self-contained. You read it top to bottom, you delete it without side effects,
and two slices share only the domain — never a catch-all "service".

## Command and query, two distinct intents

A **command** changes state and (ideally) returns nothing but an identifier. A **query**
reads only what the view needs, often bypassing the domain to project straight into a DTO.
Modeling them separately clarifies intent:

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

The handler stays **thin**: it orchestrates, it doesn't reason. The business logic lives in
`Order.Create`, not in the handler — otherwise you've just moved the "service" into another
file.

## The mediator, optional

CQRS is often glued to [MediatR](https://github.com/jbogard/MediatR). The mediator decouples
the endpoint from the handler and offers a hook for **pipeline behaviors** (validation,
logging, transactions). It's handy, but it is **not** CQRS: you can inject the handler
directly just as well.

```csharp
group.MapPost("/", async (CreateOrder command, ISender sender) =>
{
    var id = await sender.Send(command);

    return TypedResults.Created($"/orders/{id}", new { id });
});
```

If the application is small, skipping the mediator and calling the handler by hand is
perfectly legitimate — less indirection, less magic.

## Don't over-engineer

The question to ask on every slice: **do I actually need this?** Separate databases, async
projections, event sourcing — these are answers to specific scaling problems (reads vastly
outnumbering writes, an immutable audit trail). Without that problem, they only add latency
and consistency bugs. Good CQRS, in 90% of cases, is: distinct commands and queries, a single
`DbContext`, readable slices.

> CQRS isn't an architecture, it's a **naming discipline**. Separate the intents, keep the
> handlers thin, and add a message bus only the day a metric forces your hand.
