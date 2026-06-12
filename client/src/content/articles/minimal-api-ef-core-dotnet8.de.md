## Strukturierung mit Route Groups

Die Anfängerfalle besteht darin, dreißig `app.MapGet`-Aufrufe in `Program.cs` zu stapeln. Die
Lösung lässt sich in einem Wort zusammenfassen: **`MapGroup`**. Jede Ressource erhält ihre eigene
Gruppe mit Präfix, Filtern und Metadaten, definiert in einer dedizierten Extension-Methode:

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

    private static async Task<Ok<List<Todo>>> GetAllAsync(AppDbContext db) =>
        TypedResults.Ok(await db.Todos.AsNoTracking().ToListAsync());
}
```

Das `Program.cs` reduziert sich dann auf `app.MapTodos();` — ein Einstiegspunkt pro Ressource,
der Rest lebt in kohärenten Dateien.

## DbContext und Migrationen

EF Core bleibt das Rückgrat des Datenzugriffs. Der `DbContext` wird über `AddDbContext`
registriert, das Modell in `OnModelCreating` definiert, und **vor allem** lässt man das Schema
niemals manuell driften: Jede Änderung durchläuft eine versionierte Migration.

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

Die Migration wird anschließend mit `dotnet ef migrations add InitialCreate` generiert und
beim Start mit `db.Database.MigrateAsync()` angewendet — niemals `EnsureCreated`, das die
gesamte History umgeht. Die offizielle Dokumentation beschreibt den Workflow im
[guide EF Core migrations](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/).

## Typisierte Ergebnisse und Validierung

Hier spielen die Minimal APIs ihren eigentlichen Vorteil aus. Anstatt ein opakes `IActionResult`
zurückzugeben, gibt man eine **Union typisierter Ergebnisse** zurück: Die Signatur dokumentiert
die möglichen HTTP-Statuscodes, und OpenAPI exponiert sie automatisch.

```csharp
private static async Task<Results<Created<Todo>, ValidationProblem>> CreateAsync(
    CreateTodoRequest request, AppDbContext db)
{
    if (string.IsNullOrWhiteSpace(request.Title))
    {
        return TypedResults.ValidationProblem(new Dictionary<string, string[]>
        {
            ["title"] = ["Le titre est obligatoire."],
        });
    }

    var todo = new Todo { Title = request.Title };
    db.Todos.Add(todo);
    await db.SaveChangesAsync();

    return TypedResults.Created($"/todos/{todo.Id}", todo);
}
```

Der Rückgabetyp `Results<Created<Todo>, ValidationProblem>` ist **selbstdokumentierend**: Keine
redundanten `[ProducesResponseType]`-Attribute erforderlich.

## Alles testbar halten

Sobald die Handler als statische Methoden extrahiert sind, die ihre Abhängigkeiten als Parameter
erhalten, lassen sie sich trivial **ohne HTTP-Server** testen: Man instanziiert einen
`AppDbContext` mit dem In-Memory- oder SQLite-Provider, ruft den Handler auf und inspiziert das
`TypedResults`. Für End-to-End-Integrationstests lädt `WebApplicationFactory<T>` die vollständige
Anwendung im Speicher und ermöglicht das Aufrufen der echten Endpunkte.

> Eine Minimal API ist keine minderwertige API. Gut in Gruppen und typisierte Ergebnisse
> aufgeteilt, bietet sie **weniger Boilerplate für mehr Garantien** — und genau das erwartet man
> von einem modernen Framework.
