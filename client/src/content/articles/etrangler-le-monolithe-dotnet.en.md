On hérite rarement d'un projet vierge → We rarely inherit a greenfield project. Let me translate the full article now.

You rarely inherit a greenfield project. More often it's a .NET monolith that has been in production
for eight years, that nobody rereads as a whole and that the team dreads touching. The reflex is
to demand a full rewrite. The **Strangler Fig** pattern, described by
[Martin Fowler](https://martinfowler.com/bliki/StranglerFigApplication.html), proposes the
opposite: wrap the monolith, then replace it one feature at a time, until nothing is left to
switch off.

## Why not a big-bang rewrite

A full rewrite chases a moving target. During the months the team spends rebuilding, the
monolith keeps shipping fixes and features that the new version will have to catch up on before
it even exists.

On cutover day, everything goes live at once. The smallest regression hits the entire product,
and rolling back means redeploying the whole old system.

The strangler shifts the risk. Instead of a single, irreversible switch, you get a series of
small switches, each scoped to one route, each reversible. The rewrite doesn't move any faster,
but it produces value at every step without ever putting the whole product at stake.

## The facade first

Before extracting anything, you place an interception point in front of the monolith. A
reverse proxy receives all the traffic and, for now, forwards it to the old code without
exception. Functionally, this first deployment changes nothing, and that is precisely what makes
it safe to ship.

This interception point is the centerpiece of the pattern. As long as it doesn't exist, diverting
a route forces you to modify the monolith itself. Once it's in place, switching over a feature
fits in a single line of configuration, with no need to recompile the old code.

In .NET, [YARP](https://microsoft.github.io/reverse-proxy/) plays this role in-process, driven
by configuration. The most specific route wins: `/orders/...` goes to the new service, the
catch-all forwards the rest to the monolith.

```json
{
  "ReverseProxy": {
    "Routes": {
      "orders-v2": { "ClusterId": "orders-service", "Match": { "Path": "/orders/{*rest}" } },
      "legacy":    { "ClusterId": "monolith",       "Match": { "Path": "/{*rest}" } }
    },
    "Clusters": {
      "orders-service": { "Destinations": { "d1": { "Address": "https://orders.internal/" } } },
      "monolith":       { "Destinations": { "d1": { "Address": "https://legacy.internal/" } } }
    }
  }
}
```

## Choosing the first seam

Not every feature is a good candidate for the first extraction. You're looking for a **bounded
context** in the [Domain-Driven Design](https://martinfowler.com/bliki/BoundedContext.html)
sense: a cohesive set, with a clean boundary and few dependencies crossing it.

A good first candidate is loosely coupled to the rest: few shared tables, few cross-calls with
the core of the monolith. It should also hurt somewhere, either because it changes often, or
because it carries a load that the old code handles poorly.

You avoid the opposite: the central module everyone calls, or the table half the queries join
against. You rarely extract billing first. You start with a peripheral seam where failure is
contained: a read-only catalog, a notification service, an export.

## The anti-corruption layer

The new service must never speak the legacy's language. Uppercase columns, numeric status codes,
timezone-less dates: these inherited choices must not cross the boundary and contaminate the new
model. You interpose an **anti-corruption layer**, a term from Eric Evans, whose sole job is to
translate from one world to the other.

Concretely, it's a layer at the entry point of the service. It takes the DTO as produced by the
monolith and converts it into a clean domain model, with strong types.

```csharp
// Translates the legacy contract into the new domain model. Nothing past this
// point knows the monolith's column names, status codes or naked timestamps.
public sealed class LegacyOrderTranslator
{
    public Order ToDomain(LegacyOrderDto dto) => new(
        Id: new OrderId(dto.ORDER_ID),
        Status: MapStatus(dto.STATUS_CODE),
        Total: Money.FromCents(dto.TOTAL_CENTS, dto.CURRENCY),
        PlacedAt: DateTime.SpecifyKind(dto.DT, DateTimeKind.Utc));

    private static OrderStatus MapStatus(int code) => code switch
    {
        10 => OrderStatus.Pending,
        20 => OrderStatus.Paid,
        30 => OrderStatus.Shipped,
        _ => throw new UnknownLegacyStatusException(code),
    };
}
```

The translation goes both ways as long as the monolith remains the source of truth: the service
reads from legacy, applies its logic, then writes back in the format the old code expects. This
layer is also the only place that knows the quirks of the old schema. The day the legacy system
disappears, you delete the translator and nothing else needs to move.

## Migrating data ownership

This is the step the proxy doesn't solve. Routing a request is simple; moving the data it reads
and writes is much less so.

At first, the extracted service often shares the monolith's database. It reads and writes the
same tables, which avoids any synchronization but leaves two codebases living on the same data.
This is a transitional state, acceptable while the route stabilizes, not a destination.

The target is for the seam to own its data. The service gets its own store, and one of the two
writes becomes the source of truth. To maintain consistency during the transition, you either
write to both sides (dual writes), or, more safely, publish the monolith's changes via an
outbox or change data capture (CDC) that the new service consumes.

## Switch over, then measure

A route doesn't jump to 100% of traffic all at once. You start with a **canary**: a small
fraction of requests goes to the new service, the rest keeps going through the monolith. If
errors and latencies hold up, you increase the share, until the old route is cut off.

Before cutting it off, you want proof that the new path responds the same way as the old one.
Shadow traffic sends the same request to both implementations, serves the monolith's response to
the user, and compares the new service's response in the background without ever exposing it.

```csharp
// Shadow the request to the new service, keep serving the monolith's answer,
// and log any divergence for offline review. The user never sees v2 yet.
var legacy = await _monolith.GetOrderAsync(id, ct);

_ = Task.Run(async () =>
{
    var candidate = await _ordersV2.GetOrderAsync(id, ct);
    if (!OrderComparer.Equivalent(legacy, candidate))
    {
        _log.LogWarning("Shadow divergence on order {Id}", id);
    }
});

return legacy;
```

The divergences flagged by this comparison form the task list before the switch. Once the list
is empty, the canary can ramp up without a gamble.

## Removing the old path

A migrated feature leaves behind legacy code that no longer serves a purpose. The temptation is
to keep it just in case. That's how a strangled monolith ends up with two implementations of
everything, neither one removed.

The rule: you only remove a path once it's **proven dead**. The proxy's telemetry tells you how
many calls still go through the old route. As long as the counter isn't at zero over a
representative window, the code stays. Once it hits zero, you remove the legacy route, then the
code it served, then the columns nobody reads anymore.

The monolith shrinks with every seam removed. The pattern ends on its own: once the last route
has switched over, there's nothing left to route to the old process, and you shut it down.

> The strangler doesn't speed up the rewrite, it makes it reversible. Each step ships a seam
> behind the proxy, validates itself under shadow traffic, and can be undone with a single line
> of configuration. The risk is no longer concentrated on a single switch, it's spread across a
> series of small steps, each of which can fail without taking the product down with it.
