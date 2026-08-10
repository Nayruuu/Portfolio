Les **Minimal APIs** de .NET 8 retirent le `Controller`, le routage par attributs et une bonne
part de la plomberie de liaison. Un endpoint devient une méthode qui reçoit ses dépendances en
paramètres. Le risque est connu : sans découpage, tout finit empilé dans `Program.cs`. La suite
montre une API adossée à EF Core qui reste lisible et testable à mesure qu'elle grossit.

## Découper en groupes de routes

Le premier outil utile est **`MapGroup`**. Chaque ressource obtient son préfixe, ses filtres et
ses métadonnées, regroupés dans une méthode d'extension. Les handlers restent des méthodes
statiques, ce qui les garde faciles à isoler ensuite.

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

Dans `Program.cs`, il ne reste qu'un `app.MapTodos();` par ressource. `WithTags` alimente la
documentation, `WithOpenApi` enrichit chaque endpoint généré. Le groupe accepte aussi un
`AddEndpointFilter` qui s'applique d'un coup à toutes ses routes, ce qui sert pour l'autorisation
ou la validation commune.

La contrainte `{id:int}` du template travaille dès le routage : une requête `/todos/abc` ne trouve
aucune route qui matche et repart en 404 sans jamais atteindre le handler. Poser les contraintes
dans le template plutôt que dans le corps évite un `int.TryParse` défensif à l'entrée de chaque
méthode.

## Résultats typés

`Results.Ok(...)` renvoie un `IResult` opaque. `TypedResults.Ok(...)` renvoie un `Ok<T>` concret,
et cette différence débloque les unions de résultats. Une signature comme
`Results<Ok<TodoDto>, NotFound>` déclare les deux issues possibles : le compilateur vérifie que le
handler ne retourne rien d'autre, et OpenAPI publie les deux codes HTTP sans le moindre attribut
`[ProducesResponseType]`.

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

Chaque branche revient par conversion implicite vers le type d'union. Ajouter un code, un `401`
par exemple, se fait en élargissant la signature de retour, et le corps du handler cesse de
compiler tant que ce cas n'est pas traité. C'est une contrainte utile : le contrat HTTP vit dans
le type, pas dans un commentaire.

## Liaison de modèle et validation

La liaison des paramètres suit des règles fixes, sans attribut la plupart du temps. Un `int id`
qui correspond à un segment de route vient de l'URL, un type primitif sans correspondance vient de
la query string, un type complexe vient du corps JSON, et un service enregistré dans le conteneur
est injecté directement. Quand la signature s'allonge, `[AsParameters]` regroupe plusieurs
paramètres dans un `struct` dédié.

En .NET 8, les Minimal APIs **ne valident pas** les attributs DataAnnotations toutes seules. Un
`[Required]` posé sur une propriété du DTO est ignoré au binding. Deux voies : valider à la main
dans le handler, comme ci-dessous, ou brancher un `AddEndpointFilter` qui inspecte l'argument via
`context.GetArgument<CreateTodoRequest>(0)` et renvoie un `ValidationProblem` sans appeler `next`
quand le modèle est invalide. FluentValidation se greffe au même endroit.

`TypedResults.ValidationProblem` répond un `400` au format ProblemDetails (RFC 7807), le même
corps que produirait automatiquement un contrôleur annoté `[ApiController]`. Le client voit donc
la même structure d'erreur, qu'il tape une route Minimal API ou un contrôleur classique.

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

## EF Core : DbContext, requêtes, migrations

`AddDbContext<AppDbContext>` enregistre le contexte avec une durée de vie **scoped** : une
instance par requête HTTP, injectée dans le handler comme n'importe quel service. Ce choix n'est
pas cosmétique : un `DbContext` n'est pas thread-safe et ne doit pas être partagé entre requêtes,
et la portée scoped garantit exactement cette isolation. Pour des débits élevés, `AddDbContextPool`
recycle les instances au lieu d'en allouer une neuve à chaque appel.

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

En lecture, `AsNoTracking` désactive le suivi des changements : EF Core ne construit pas de
snapshots pour comparer plus tard, ce qui allège les requêtes qui ne font que renvoyer des
données. Le `Select` vers un `record TodoDto` va plus loin : il limite les colonnes réellement
chargées au lieu de matérialiser l'entité entière avant de la mapper en mémoire. C'est la
différence entre un `SELECT Id, Title, IsDone` et un `SELECT *` suivi d'une projection côté client.

En écriture, `db.Todos.Add(entity)` puis un seul `SaveChangesAsync` valident la transaction. EF
Core émet l'`INSERT` et récupère la clé générée dans `entity.Id`, disponible aussitôt pour
construire l'URL du `Created`.

Le schéma se pilote par migrations : `dotnet ef migrations add InitialCreate` produit un fichier
versionné, appliqué au démarrage avec `db.Database.MigrateAsync()`. `EnsureCreated` crée bien les
tables mais ignore complètement l'historique de migrations, ce qui rend la première vraie
migration impossible ensuite ; à réserver aux bases jetables. Le workflow complet est décrit dans
le [guide des migrations EF Core](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/).

## Minimal API ou contrôleur

Les Minimal APIs couvrent bien les API JSON, les services internes, les backends de SPA et les
fonctions à faible surface. Les contrôleurs gardent l'avantage quand on s'appuie sur
`[ApiController]` et sa validation automatique, sur les filtres MVC (action, résultat, exception),
sur le model binding riche des formulaires, ou sur des conventions d'équipe déjà en place.

Les deux styles cohabitent dans la même application. Rien n'oblige à trancher globalement : on
peut exposer une ressource en Minimal API et conserver un contrôleur là où son outillage rend
encore service.

## Garder le tout testable

Des handlers statiques qui reçoivent leurs dépendances en paramètres se testent **sans serveur
HTTP** : on instancie un `AppDbContext` sur le provider SQLite in-memory, on appelle le handler,
on inspecte le résultat. `TypedResults` aide là aussi, puisque le type de retour concret expose
directement le `StatusCode` et la valeur, sans désérialiser une réponse.

Pour le bout en bout, `WebApplicationFactory<Program>` démarre l'application en mémoire et laisse
frapper les vrais endpoints via un `HttpClient`, filtres et liaison compris. Avec des top-level
statements, la classe `Program` générée est interne : un `public partial class Program { }` en fin
de fichier suffit à la rendre visible depuis le projet de test.

> Une Minimal API bien tenue n'a rien d'un prototype. Le style enlève la cérémonie héritée des
> contrôleurs ; la conception, elle, reste entièrement à votre charge.
