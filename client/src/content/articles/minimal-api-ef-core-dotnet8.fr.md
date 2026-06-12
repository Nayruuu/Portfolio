Les **Minimal APIs** ont mauvaise réputation : on les croit réservées aux démos jetables.
En réalité, avec un peu de discipline, elles donnent une API .NET 8 plus lisible et plus
testable qu'un contrôleur classique — à condition de ne pas tout entasser dans `Program.cs`.

## Découper avec des route groups

Le piège du débutant, c'est d'empiler trente `app.MapGet` dans le `Program.cs`. La parade
tient en un mot : **`MapGroup`**. Chaque ressource a son groupe, avec son préfixe, ses
filtres et ses métadonnées, défini dans une méthode d'extension dédiée :

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

Le `Program.cs` se résume alors à `app.MapTodos();` — un point d'entrée par ressource, le
reste vit dans des fichiers cohérents.

## DbContext et migrations

EF Core reste la colonne vertébrale de l'accès aux données. On enregistre le `DbContext` via
`AddDbContext`, on modélise dans `OnModelCreating`, et **surtout** on ne laisse jamais le
schéma dériver à la main : chaque changement passe par une migration versionnée.

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

On génère ensuite la migration avec `dotnet ef migrations add InitialCreate`, et on
l'applique au démarrage avec `db.Database.MigrateAsync()` — jamais `EnsureCreated`, qui
court-circuite tout l'historique. La doc officielle détaille le workflow dans le
[guide EF Core migrations](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/).

## Résultats typés et validation

C'est ici que les Minimal APIs gagnent vraiment. Plutôt que de renvoyer un `IActionResult`
opaque, on retourne un **union de résultats typés** : la signature documente les codes HTTP
possibles, et OpenAPI les expose automatiquement.

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

Le type de retour `Results<Created<Todo>, ValidationProblem>` est **auto-documentant** : pas
besoin d'attributs `[ProducesResponseType]` redondants.

## Garder le tout testable

Une fois les handlers extraits en méthodes statiques qui reçoivent leurs dépendances en
paramètres, ils deviennent triviaux à tester **sans serveur HTTP** : on instancie un
`AppDbContext` sur le provider in-memory ou SQLite, on appelle le handler, on inspecte le
`TypedResults`. Pour les tests d'intégration de bout en bout, `WebApplicationFactory<T>`
monte l'application complète en mémoire et permet de taper les vrais endpoints.

> Une Minimal API n'est pas une API au rabais. Bien découpée en groupes et en résultats
> typés, elle expose **moins de cérémonie pour plus de garanties** — et c'est exactement ce
> qu'on veut d'un framework moderne.
