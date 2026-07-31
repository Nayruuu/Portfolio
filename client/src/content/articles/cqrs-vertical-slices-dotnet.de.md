Viele Teams verbinden **CQRS** mit Event Sourcing, Message-Bus-Systemen, getrennten
Datenbanken. Die Grundidee ist dabei bescheiden: **Lesen von Schreiben trennen**. Sie lässt
sich ohne Overengineering anwenden, indem man den Code in **Vertical Slices** organisiert.

## Nach Funktionalität schneiden, nicht nach Schicht

Die geschichtete Architektur zerlegt eine Funktionalität in fünf Ordner: `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. Um „eine Bestellung erstellen“ zu verstehen,
springt man von Datei zu Datei. Der **Vertical Slice** kehrt diese Logik um: ein Ordner pro
Funktionalität, alles, was dazugehört, an einem Ort.

```bash
Features/
  Orders/
    CreateOrder.cs      # command + handler + validator
    GetOrderById.cs     # query + handler
    ListOrders.cs
```

Jeder Slice ist eigenständig: Er lässt sich von oben nach unten lesen und ohne Nebenwirkungen
löschen. Zwei Slices teilen sich nur die Domäne, niemals einen Allzweck-„Service“.

## Command und Query, zwei unterschiedliche Absichten

Ein **Command** verändert den Zustand und gibt (idealerweise) nur eine ID zurück. Eine
**Query** liest nichts anderes als das, was die View braucht, oft unter Umgehung der Domäne,
um direkt auf ein DTO zu projizieren. Sie getrennt zu modellieren, macht die Absicht klar:

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

Der Handler bleibt **schlank**: Er orchestriert, ohne selbst zu entscheiden. Die
Geschäftslogik lebt in `Order.Create`, nicht im Handler. Sonst hätte man den „Service“ nur in
eine andere Datei verschoben.

## Der Mediator, optional

Man sieht CQRS oft an [MediatR](https://github.com/jbogard/MediatR) gekoppelt. Der Mediator
entkoppelt den Endpoint vom Handler und bietet einen Anknüpfungspunkt für **Pipeline
Behaviors** (Validierung, Logging, Transaktion). Das ist praktisch, aber es ist **nicht**
CQRS: Man kann den Handler ohne Weiteres auch direkt injizieren.

```csharp
group.MapPost("/", async (CreateOrder command, ISender sender) =>
{
    var id = await sender.Send(command);

    return TypedResults.Created($"/orders/{id}", new { id });
});
```

Ist die Anwendung klein, bleibt es legitim, den Mediator auszulassen und den Handler von Hand
aufzurufen: Man entfernt eine Indirektionsschicht und die dazugehörige Magie.

## Kein Overengineering

Die Frage, die man sich bei jedem Slice stellen sollte: **Brauche ich das wirklich?**
Getrennte Datenbanken, asynchrone Projektionen, Event Sourcing lösen konkrete
Skalierungsprobleme (Lesezugriffe massiv häufiger als Schreibzugriffe, unveränderliches
Audit-Log). Ohne dieses Problem fügen sie nur Latenz und Konsistenzfehler hinzu.

Das richtige CQRS, in 90 % der Fälle: getrennte Commands und Queries, ein einziger
`DbContext`, lesbare Slices.

> CQRS ist eher eine **Namensdisziplin** als eine Architektur. Trennen Sie die Absichten,
> halten Sie die Handler schlank, und fügen Sie erst dann einen Message-Bus hinzu, wenn eine
> Metrik Sie dazu zwingt.
