Die **Minimal APIs** von .NET 8 entfernen den `Controller`, das Routing per Attribute und einen
Großteil der Bindungs-Plumbing. Ein Endpoint wird zu einer Methode, die ihre Abhängigkeiten als
Parameter erhält. Das Risiko ist bekannt: ohne Aufteilung landet alles gestapelt in `Program.cs`.
Im Folgenden wird eine API auf Basis von EF Core gezeigt, die lesbar und testbar bleibt, während
sie wächst.

## In Routengruppen aufteilen

Das erste nützliche Werkzeug ist **`MapGroup`**. Jede Ressource erhält ihr eigenes Präfix, ihre
Filter und ihre Metadaten, gebündelt in einer Extension-Methode. Die Handler bleiben statische
Methoden, was sie später leicht isolierbar macht.

```csharp
public static class TodoEndpoints
{
    public static RouteGroupBuilder MapTodos(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/todos")
            .WithTags("Todos")
            .WithOpenApi();

        group.MapGet("/", GetAllAsync);
        group.MapGet("/{id:int}", GetByIdAsync);
        group.MapPost("/", CreateAsync);

        return group;
    }

    // Read-only: no change tracking, projected straight to the DTO.
    private static async Task<Ok<List<TodoDto>>> GetAllAsync(AppDbContext db) =>
        TypedResults.Ok(await db.Todos
            .AsNoTracking()
            .OrderByDescending(t => t.Id)
            .Select(t => new TodoDto(t.Id, t.Title, t.IsDone))
            .ToListAsync());
}
```

In `Program.cs` bleibt pro Ressource nur ein `app.MapTodos();` übrig. `WithTags` speist die
Dokumentation, `WithOpenApi` reichert jeden generierten Endpoint an. Die Gruppe akzeptiert
außerdem einen `AddEndpointFilter`, der auf einen Schlag für alle ihre Routen gilt — praktisch für
Autorisierung oder gemeinsame Validierung.

Die Einschränkung `{id:int}` im Template greift bereits beim Routing: Eine Anfrage `/todos/abc`
findet keine passende Route und liefert direkt einen 404, ohne jemals den Handler zu erreichen.
Einschränkungen im Template statt im Methodenkörper zu platzieren erspart ein defensives
`int.TryParse` am Eingang jeder Methode.

## Typisierte Ergebnisse

`Results.Ok(...)` liefert ein opakes `IResult`. `TypedResults.Ok(...)` liefert ein konkretes
`Ok<T>`, und genau dieser Unterschied schaltet Ergebnis-Unions frei. Eine Signatur wie
`Results<Ok<TodoDto>, NotFound>` deklariert die beiden möglichen Ausgänge: Der Compiler prüft, dass
der Handler nichts anderes zurückgibt, und OpenAPI veröffentlicht beide HTTP-Codes ohne das
geringste `[ProducesResponseType]`-Attribut.

```csharp
public record TodoDto(int Id, string Title, bool IsDone);

private static async Task<Results<Ok<TodoDto>, NotFound>> GetByIdAsync(int id, AppDbContext db)
{
    var todo = await db.Todos
        .AsNoTracking()
        .Where(t => t.Id == id)
        .Select(t => new TodoDto(t.Id, t.Title, t.IsDone))
        .FirstOrDefaultAsync();

    return todo is null
        ? TypedResults.NotFound()
        : TypedResults.Ok(todo);
}
```

Jeder Zweig kehrt per impliziter Konvertierung in den Union-Typ zurück. Einen Code hinzuzufügen,
etwa `401`, geschieht durch Erweitern der Rückgabesignatur, und der Handler-Körper hört auf zu
kompilieren, solange dieser Fall nicht behandelt ist. Das ist eine nützliche Einschränkung: Der
HTTP-Vertrag lebt im Typ, nicht in einem Kommentar.

## Modellbindung und Validierung

Die Bindung der Parameter folgt festen Regeln, meist ohne Attribute. Ein `int id`, der einem
Routensegment entspricht, kommt aus der URL, ein primitiver Typ ohne Entsprechung kommt aus dem
Query-String, ein komplexer Typ kommt aus dem JSON-Body, und ein im Container registrierter
Service wird direkt injiziert. Wenn die Signatur zu lang wird, bündelt `[AsParameters]` mehrere
Parameter in einem dedizierten `struct`.

In .NET 8 validieren die Minimal APIs die DataAnnotations-Attribute **nicht** von selbst. Ein
`[Required]` auf einer DTO-Eigenschaft wird beim Binding ignoriert. Zwei Wege stehen offen: manuell
im Handler validieren, wie unten gezeigt, oder einen `AddEndpointFilter` einklinken, der das
Argument über `context.GetArgument<CreateTodoRequest>(0)` inspiziert und ein `ValidationProblem`
zurückgibt, ohne `next` aufzurufen, wenn das Modell ungültig ist. FluentValidation setzt an
derselben Stelle an.

`TypedResults.ValidationProblem` antwortet mit einem `400` im ProblemDetails-Format (RFC 7807),
demselben Body, den ein mit `[ApiController]` annotierter Controller automatisch erzeugen würde.
Der Client sieht also dieselbe Fehlerstruktur, egal ob er eine Minimal-API-Route oder einen
klassischen Controller anspricht.

```csharp
private static async Task<Results<Created<TodoDto>, ValidationProblem>> CreateAsync(
    CreateTodoRequest request, AppDbContext db)
{
    // No automatic DataAnnotations in .NET 8 Minimal APIs: check by hand.
    if (string.IsNullOrWhiteSpace(request.Title))
    {
        return TypedResults.ValidationProblem(new Dictionary<string, string[]>
        {
            ["title"] = ["Title is required."],
        });
    }

    var todo = new Todo { Title = request.Title.Trim() };
    db.Todos.Add(todo);
    await db.SaveChangesAsync();

    var dto = new TodoDto(todo.Id, todo.Title, todo.IsDone);
    return TypedResults.Created($"/todos/{todo.Id}", dto);
}
```

## EF Core: DbContext, Abfragen, Migrationen

`AddDbContext<AppDbContext>` registriert den Context mit einer **scoped**-Lebensdauer: eine
Instanz pro HTTP-Anfrage, injiziert in den Handler wie jeder andere Service. Diese Wahl ist nicht
kosmetisch: Ein `DbContext` ist nicht thread-sicher und darf nicht zwischen Anfragen geteilt
werden, und der Scoped-Gültigkeitsbereich garantiert genau diese Isolation. Bei hohem Durchsatz
recycelt `AddDbContextPool` die Instanzen, statt bei jedem Aufruf eine neue zu allokieren.

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

Beim Lesen deaktiviert `AsNoTracking` das Change Tracking: EF Core baut keine Snapshots zum
späteren Vergleich auf, was Abfragen entlastet, die nur Daten zurückgeben. Das `Select` auf einen
`record TodoDto` geht noch weiter: Es begrenzt die tatsächlich geladenen Spalten, statt zunächst
die gesamte Entität zu materialisieren und sie dann im Speicher zu mappen. Das ist der Unterschied
zwischen einem `SELECT Id, Title, IsDone` und einem `SELECT *` mit anschließender Projektion auf
Client-Seite.

Beim Schreiben validieren `db.Todos.Add(entity)` und anschließend ein einziges
`SaveChangesAsync` die Transaktion. EF Core sendet das `INSERT` und holt den generierten
Schlüssel in `entity.Id` ab, der sofort zum Aufbau der `Created`-URL zur Verfügung steht.

Das Schema wird über Migrationen gesteuert: `dotnet ef migrations add InitialCreate` erzeugt eine
versionierte Datei, die beim Start mit `db.Database.MigrateAsync()` angewendet wird.
`EnsureCreated` erstellt zwar die Tabellen, ignoriert aber vollständig die Migrationshistorie, was
die erste echte Migration danach unmöglich macht; nur für wegwerfbare Datenbanken reservieren. Der
vollständige Workflow ist im
[EF-Core-Migrationsleitfaden](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/)
beschrieben.

## Minimal API oder Controller

Die Minimal APIs decken JSON-APIs, interne Services, SPA-Backends und Funktionen mit geringer
Oberfläche gut ab. Die Controller behalten den Vorteil, wenn man auf `[ApiController]` und dessen
automatische Validierung setzt, auf MVC-Filter (Action, Result, Exception), auf das umfangreiche
Model-Binding von Formularen oder auf bereits bestehende Team-Konventionen.

Beide Stile koexistieren in derselben Anwendung. Nichts zwingt zu einer globalen Entscheidung: Man
kann eine Ressource als Minimal API exponieren und einen Controller dort behalten, wo dessen
Tooling weiterhin nützlich ist.

## Alles testbar halten

Statische Handler, die ihre Abhängigkeiten als Parameter erhalten, lassen sich **ohne HTTP-Server**
testen: Man instanziiert einen `AppDbContext` auf dem SQLite-In-Memory-Provider, ruft den Handler
auf und prüft das Ergebnis. `TypedResults` hilft auch hier, da der konkrete Rückgabetyp den
`StatusCode` und den Wert direkt exponiert, ohne eine Antwort deserialisieren zu müssen.

Für den End-to-End-Test startet `WebApplicationFactory<Program>` die Anwendung im Speicher und
lässt die echten Endpoints über einen `HttpClient` ansprechen, inklusive Filtern und Bindung. Mit
Top-Level-Statements ist die generierte Klasse `Program` intern: Ein `public partial class Program
{ }` am Dateiende genügt, um sie aus dem Testprojekt sichtbar zu machen.

> Eine gut gepflegte Minimal API hat nichts von einem Prototypen an sich. Der Stil entfernt die von
> den Controllern geerbte Zeremonie; das Design hingegen bleibt vollständig in Ihrer Verantwortung.
