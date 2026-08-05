Beyond software engineering, many teams file **CQRS** in the same drawer as event sourcing, message
buses, and duplicated databases. Yet the original idea is modest: separate the read path from the
write path. It's applied without extra infrastructure, by organizing code into **vertical slices**,
one feature per folder.

## Split by feature, not by layer

Layered architecture splits a feature across five folders: `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. To follow "create an order" end
to end, you jump from file to file, and each folder ends up mixing pieces of
dozens of unrelated features.

The **vertical slice** flips the organization around: one folder per use case, everything about it
in the same place.

```bash
Features/
  Orders/
    CreateOrder.cs      # command + handler + validator
    GetOrderById.cs     # query + handler
    ListOrders.cs
```

A slice contains its request, its handler, the validator that goes with it, and the DTO it
returns. It reads top to bottom and deletes without side effects: nothing else depends on
it. Two slices only share the **domain**, never a catch-all "service" that the whole
application dips into. Jimmy Bogard, who popularized the approach under the name
[vertical slice architecture](https://www.jimmybogard.com/vertical-slice-architecture/), sums up
the guiding constraint: what changes together lives together.

## Command and query, two distinct intents

A **command** changes state and ideally returns only an identifier, or nothing. A
**query** reads only what the view needs and touches nothing. Modeling them as two
separate types makes the intent readable straight from the signature.

The distinction isn't new. It extends Bertrand Meyer's **Command-Query Separation** principle,
where a method either changes state or returns a value, never both. Greg Young
turned it into an acronym, CQRS, pushing the idea to the scale of a whole model rather than a
single method.

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
`Order.Create`, where the aggregate protects its invariants. If it migrates into the handler, you've
just renamed the "service" you were trying to escape.

A handler this flat is tested without ceremony: it receives its dependencies as parameters, you
instantiate it with an `AppDbContext` on SQLite or the in-memory provider, call `Handle`, and
inspect the return value. No HTTP server to spin up, no pipeline to simulate.

## Two data models for two needs

It's on the read side that the separation pays off, even with a single database. The write side goes
through the aggregate because it has to validate rules before mutating state. The read side has no
reason to rebuild that aggregate: it projects the table directly into the DTO the caller expects.

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

`AsNoTracking` disables the change tracker, which is pointless for a read, and the `Select` lets EF Core
generate a `SELECT` that only pulls back the projected columns. The query is no longer a prisoner
of the write model's shape: it assembles exactly the intended view, sums and joins
included.

The day reads become the bottleneck, that same slice becomes the natural anchor point for plugging
in Dapper, raw SQL, or a denormalized table, without touching the write side. Nothing forces you to
do it until a metric demands it.

## The mediator, an implementation detail

CQRS often comes bundled with [MediatR](https://github.com/jbogard/MediatR). The mediator decouples
the endpoint from the handler and provides an anchor point for **pipeline behaviors**. An endpoint
then just sends the message: `await sender.Send(command)` returns the identifier, which
gets wrapped in a `TypedResults.Created`.

Convenient, but separate: nothing in CQRS requires a mediator. You can inject the handler
directly into the endpoint and call it by hand. MediatR has, moreover, moved to a
commercial license, which makes the homegrown option more compelling than before: a dispatcher that resolves
`IRequestHandler<,>` from the container and calls `Handle` fits in about fifteen lines. On
a small application, that one less layer of indirection is often worth it.

The endpoint itself can live in the slice's file, exposed through an extension method
`MapCreateOrder` that `Program.cs` simply calls like a `MapGroup`. The route, the
command, and the handler then all fit in the same file, and nothing about the feature
lives elsewhere.

## Where to put validation and cross-cutting concerns

Validation, logging, opening a transaction: these concerns recur in every
slice. Copying them into every handler is the surest way to miss one. A **pipeline
behavior** factors them out by wrapping every handler at once.

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

Each slice declares its [FluentValidation validator](https://docs.fluentvalidation.net/), the
behavior picks it up through injection and triggers it before the handler. Registered once via
`AddOpenBehavior(typeof(ValidationBehavior<,>))`, it covers commands and queries without repeated
code.

The behavior has a cost: it's invisible control flow. Use it sparingly, each one clearly
scoped, otherwise you recreate the magic you blamed the mediator for.

## Don't over-engineer

The question to ask in front of every slice remains the same: **do I actually need this?** Separate
databases, asynchronous projections, event sourcing answer specific problems: reads massively
outnumbering writes, an immutable audit trail, a read model far removed from the write
model. Absent that problem, they only add latency and delayed-consistency bugs.

The useful CQRS, in the vast majority of cases: separate commands and queries, a
single `DbContext`, slices you can read without grepping. Everything else waits for a
quantified reason.

> CQRS starts as a naming discipline before it's an architecture. Separate
> intents, keep handlers thin, let reads bypass the domain, and
> only add a message bus the day a measurement forces you to.
