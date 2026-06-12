## Nach Funktionalität schneiden, nicht nach Schicht

Die Schichtenarchitektur zerlegt eine Funktionalität auf fünf Ordner: `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. Um „eine Bestellung erstellen" zu verstehen,
springt man von Datei zu Datei. Der **Vertical Slice** kehrt die Logik um: ein Ordner pro
Funktionalität, alles Zugehörige an einem Ort.

```bash
Features/
  Orders/
    CreateOrder.cs      # commande + handler + validateur
    GetOrderById.cs     # requête + handler
    ListOrders.cs
```

Jeder Slice ist eigenständig. Man liest ihn von oben nach unten, löscht ihn ohne Seiteneffekte,
und zwei Slices teilen nur die Domäne — niemals einen Allzweck-„Service".

## Command und Query, zwei unterschiedliche Absichten

Ein **Command** ändert den Zustand und gibt (idealerweise) nur eine ID zurück. Eine **Query**
liest nur das, was die Ansicht benötigt, und umgeht dabei oft die Domäne, um direkt auf ein
DTO zu projizieren. Sie getrennt zu modellieren, verdeutlicht die Absicht:

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

Der Handler bleibt **schlank**: Er orchestriert, er denkt nicht. Die Geschäftslogik lebt in
`Order.Create`, nicht im Handler — sonst hat man den „Service" nur in eine andere Datei
verschoben.

## Der Mediator, optional

Man sieht CQRS häufig zusammen mit [MediatR](https://github.com/jbogard/MediatR). Der Mediator
entkoppelt den Endpoint vom Handler und bietet einen Einstiegspunkt für **Pipeline Behaviors**
(Validierung, Logging, Transaktion). Das ist praktisch, aber es ist **nicht** CQRS: Man kann
den Handler auch direkt injizieren.

```csharp
group.MapPost("/", async (CreateOrder command, ISender sender) =>
{
    var id = await sender.Send(command);

    return TypedResults.Created($"/orders/{id}", new { id });
});
```

Bei einer kleinen Anwendung ist es völlig legitim, den Mediator wegzulassen und den Handler
direkt aufzurufen — weniger Indirektion, weniger Magie.

## Nicht überentwerfen

Die Frage, die man sich bei jedem Slice stellen sollte: **Brauche ich das wirklich?** Getrennte
Datenbanken, asynchrone Projektionen, Event Sourcing — das sind Antworten auf konkrete
Skalierungsprobleme (massiv mehr Lesezugriffe als Schreibzugriffe, unveränderliches Audit-Log).
Ohne dieses Problem fügen sie nur Latenz und Konsistenzfehler hinzu. Gutes CQRS bedeutet in
90 % der Fälle: getrennte Commands und Queries, ein einziger `DbContext`, lesbare Slices.

> CQRS ist keine Architektur, sondern eine **Benennungs-Disziplin**. Trennt die Absichten,
> haltet die Handler schlank, und fügt einen Message Bus erst dann hinzu, wenn eine Metrik
> euch dazu zwingt.
