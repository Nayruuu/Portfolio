Beviele Teams stecken **CQRS** in dieselbe Schublade wie Event Sourcing, Message-Busse und
duplizierte Datenbanken. Die ursprüngliche Idee ist jedoch bescheiden: den Lesepfad vom
Schreibpfad zu trennen. Man wendet sie ohne zusätzliche Infrastruktur an, indem man den Code
nach **vertical slices** organisiert, ein Feature pro Ordner.

## Nach Feature schneiden, nicht nach Schicht

Die Schichtenarchitektur zersplittert ein Feature in fünf Ordner: `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. Um „eine Bestellung erstellen" von Anfang bis
Ende zu verfolgen, springt man von Datei zu Datei, und jeder Ordner vermischt am Ende Fragmente
aus Dutzenden voneinander unabhängiger Features.

Der **vertical slice** kehrt diese Ordnung um: ein Ordner pro Use Case, alles, was ihn betrifft,
am selben Ort.

```bash
Features/
  Orders/
    CreateOrder.cs      # command + handler + validator
    GetOrderById.cs     # query + handler
    ListOrders.cs
```

Ein Slice enthält seinen Request, seinen Handler, den dazugehörigen Validator und das DTO, das
er zurückgibt. Er liest sich von oben nach unten und lässt sich ohne Nebenwirkungen löschen:
nichts anderes hängt von ihm ab. Zwei Slices teilen sich nur die **Domain**, niemals einen
Alleskönner-„Service", aus dem die gesamte Anwendung schöpft. Jimmy Bogard, der den Ansatz unter
dem Namen [vertical slice architecture](https://www.jimmybogard.com/vertical-slice-architecture/)
populär gemacht hat, formuliert die tragende Bedingung: Was zusammen ändert, lebt zusammen.

## Command und Query, zwei getrennte Intentionen

Ein **Command** verändert den Zustand und gibt idealerweise nur eine ID zurück, oder nichts.
Eine **Query** liest nur das, was die View benötigt, und verändert nichts. Sie als zwei separate
Typen zu modellieren macht die Absicht bereits an der Signatur ablesbar.

Die Unterscheidung ist nicht neu. Sie setzt das Prinzip der **Command-Query Separation** von
Bertrand Meyer fort, bei dem eine Methode entweder den Zustand ändert oder einen Wert
zurückgibt, niemals beides. Greg Young hat daraus ein Akronym gemacht, CQRS, indem er die Idee
auf die Ebene eines gesamten Modells statt einer einzelnen Methode gehoben hat.

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

Der Handler bleibt **schlank**: er orchestriert, er denkt nicht. Die Geschäftslogik lebt in
`Order.Create`, wo das Aggregate seine Invarianten schützt. Wandert sie in den Handler, hat man
den „Service" nur umbenannt, dem man eigentlich entkommen wollte.

Ein derart flacher Handler lässt sich ohne Umstände testen: er erhält seine Abhängigkeiten als
Parameter, man instanziiert ihn mit einem `AppDbContext` auf SQLite oder dem In-Memory-Provider,
ruft `Handle` auf, prüft den Rückgabewert. Kein HTTP-Server hochzufahren, keine Pipeline zu
simulieren.

## Zwei Datenmodelle für zwei Bedürfnisse

Auf der Leseseite zahlt sich die Trennung aus, selbst mit nur einer Datenbank. Die Schreibseite
läuft über das Aggregate, weil sie Regeln validieren muss, bevor sie den Zustand mutiert. Die
Leseseite hat keinen Grund, dieses Aggregate zu rekonstruieren: sie projiziert die Tabelle
direkt auf das vom Aufrufer erwartete DTO.

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

`AsNoTracking` schaltet den Change Tracker ab, der für eine Lesung unnötig ist, und das
`Select` lässt EF Core ein `SELECT` generieren, das nur die projizierten Spalten zurückliefert.
Die Query ist nicht mehr an die Form des Schreibmodells gebunden: sie stellt genau die
gewünschte View zusammen, Summen und Joins inklusive.

Wird die Leseseite eines Tages zum Flaschenhals, ist genau dieser Slice der Ansatzpunkt, um
Dapper, rohes SQL oder eine denormalisierte Tabelle einzuklinken, ohne die Schreibseite
anzufassen. Nichts zwingt dazu, solange keine Metrik es verlangt.

## Der Mediator, ein Implementierungsdetail

CQRS kommt oft zusammen mit [MediatR](https://github.com/jbogard/MediatR). Der Mediator
entkoppelt den Endpoint vom Handler und bietet einen Ansatzpunkt für **Pipeline Behaviors**.
Ein Endpoint muss dann nur noch die Message senden: `await sender.Send(command)` gibt die ID
zurück, die man in ein `TypedResults.Created` einpackt.

Praktisch, aber optional: nichts in CQRS schreibt einen Mediator vor. Man kann den Handler
direkt in den Endpoint injizieren und ihn von Hand aufrufen. MediatR ist zudem auf eine
kommerzielle Lizenz umgestiegen, was die selbstgebaute Option ernsthafter macht als zuvor: ein
Dispatcher, der `IRequestHandler<,>` im Container auflöst und `Handle` aufruft, kommt mit etwa
fünfzehn Zeilen aus. Bei einer kleinen Anwendung lohnt sich diese eingesparte Indirektion oft.

Der Endpoint selbst kann in der Datei des Slice leben, exponiert über eine
Extension-Methode `MapCreateOrder`, die die `Program.cs` einfach wie eine `MapGroup` aufruft.
Route, Command und Handler stecken dann in derselben Datei, und nichts vom Feature liegt
anderswo herum.

## Wo Validierung und Querschnittsbelange platziert werden

Validierung, Logging, das Öffnen einer Transaktion: diese Belange kehren in jedem Slice wieder.
Sie in jedem Handler zu duplizieren ist der beste Weg, einen davon zu vergessen. Ein
**Pipeline Behavior** faktorisiert sie heraus, indem es alle Handler auf einmal umschließt.

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

Jeder Slice deklariert seinen [FluentValidation-Validator](https://docs.fluentvalidation.net/),
das Behavior holt ihn per Injection und löst ihn vor dem Handler aus. Einmal registriert über
`AddOpenBehavior(typeof(ValidationBehavior<,>))`, deckt es Commands und Queries ohne
wiederholten Code ab.

Das Behavior hat einen Preis: es ist unsichtbarer Kontrollfluss. Man braucht davon wenige, jedes
klar abgegrenzt, sonst schafft man erneut die Magie, die man dem Mediator vorgeworfen hat.

## Nicht über-designen

Die Frage, die man sich vor jedem Slice stellen sollte, bleibt dieselbe: **brauche ich das
wirklich?** Getrennte Datenbanken, asynchrone Projektionen, Event Sourcing beantworten konkrete
Probleme: Lesezugriffe, die die Schreibzugriffe massiv übersteigen, unveränderliches Auditing,
ein Lesemodell, das weit vom Schreibmodell entfernt ist. Ohne dieses Problem fügen sie nur
Latenz und zeitversetzte Konsistenzbugs hinzu.

Das nützliche CQRS ist in der überwältigenden Mehrheit der Fälle: getrennte Commands und
Queries, ein einziger `DbContext`, Slices, die man ohne grep lesen kann. Der Rest wartet auf
einen belegbaren Grund.

> CQRS beginnt als Namensgebungsdisziplin, bevor es eine Architektur wird. Trennen Sie die
> Intentionen, halten Sie die Handler schlank, lassen Sie die Lesezugriffe die Domain
> umgehen, und fügen Sie einen Message-Bus erst hinzu, wenn eine Messung Sie dazu zwingt.
