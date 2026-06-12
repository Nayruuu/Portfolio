You rarely inherit a **greenfield**. More often it's a .NET monolith that has been running
in production for eight years, that nobody dares touch. The **Strangler Fig** pattern lets
you replace it **piece by piece**, with no big-bang and no downtime window.

## The principle

You put a façade in front of the monolith, then **reroute** one route at a time toward a
new service. As long as a feature hasn't been rewritten, it keeps going through the old
code. The day the last route flips over, the monolith is dead — strangled.

### An anti-corruption layer

The new code must never speak the legacy's language. You interpose an
**anti-corruption layer** that translates the old world's models into the new one:

```csharp
public sealed class LegacyOrderTranslator
{
    public Order ToDomain(LegacyOrderDto dto) => new(
        Id: new OrderId(dto.ORDER_ID),
        Total: Money.FromCents(dto.TOTAL_CENTS),
        PlacedAt: DateTime.SpecifyKind(dto.DT, DateTimeKind.Utc));
}
```

## Route at the right level

The switch is ideally done at the **reverse proxy** level (YARP, Nginx) rather than in the
code, to keep both worlds perfectly isolated. With [YARP](https://microsoft.github.io/reverse-proxy/),
a single route in configuration is enough to divert a path to the new service.

- a migrated route → new service
- a non-migrated route → monolith
- a canary → 5% of traffic, then 100%

## Measure before you cut

Every migrated route is paired with **shadow traffic** compared against the old response
before cutting for good. You only delete the old code once it is **provably dead**: as long
as a call still flows through it, it stays. Telemetry becomes the migration's referee.

> Strangling isn't about rewriting faster. It's about rewriting in a **reversible** way:
> at every step, you can roll back with a single line of configuration.
