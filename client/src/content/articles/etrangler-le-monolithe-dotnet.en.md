We rarely inherit a **greenfield**. More often, it's a .NET monolith that has been running
in production for eight years, one that nobody dares touch. The **Strangler Fig** pattern lets
you replace it **piece by piece**, without a big bang and without a cutover window.

## The principle

You place a facade in front of the monolith, then reroute one route at a time to
a new service. As long as a feature hasn't been rewritten, it keeps going
through the old code. The day the last route switches over, nothing passes through the
monolith anymore: you can turn it off.

### An anti-corruption layer

The new code must never speak the language of the legacy system. You interpose an
**anti-corruption layer** that translates the models from the old world to the new one:

```csharp
public sealed class LegacyOrderTranslator
{
    public Order ToDomain(LegacyOrderDto dto) => new(
        Id: new OrderId(dto.ORDER_ID),
        Total: Money.FromCents(dto.TOTAL_CENTS),
        PlacedAt: DateTime.SpecifyKind(dto.DT, DateTimeKind.Utc));
}
```

## Routing at the right level

The switchover is ideally done at the **reverse proxy** level (YARP, Nginx) rather than in
the code, to keep the two worlds isolated. With [YARP](https://microsoft.github.io/reverse-proxy/),
a simple configuration route is enough to divert a path to the new service.

- a migrated route → new service
- a non-migrated route → monolith
- a canary → 5% of traffic, then 100%

## Measure before cutting

Each migrated route is paired with **shadow traffic** compared against the old response before
cutting it off for good. The old code is only removed once **proven dead**: as long as a call
still goes through it, it stays. Telemetry arbitrates the migration.

> The strangler doesn't speed up the rewrite, it makes it **reversible**: at every step,
> you can roll back with a single line of configuration.
