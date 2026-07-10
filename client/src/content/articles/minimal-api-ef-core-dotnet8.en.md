**Minimal APIs** have a bad reputation: people think they're only good for throwaway demos.
In reality, with a bit of discipline, they yield a .NET 8 API that's more readable and more
testable than a classic controller — as long as you don't pile everything into `Program.cs`.

## Split with route groups

The beginner trap is stacking thirty `app.MapGet` calls in `Program.cs`. The fix is one
word: **`MapGroup`**. Each resource gets its own group, with its prefix, filters and
metadata, defined in a dedicated extension method:

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

`Program.cs` then boils down to `app.MapTodos();` — one entry point per resource, everything
else lives in cohesive files.

## DbContext and migrations

EF Core remains the backbone of data access. You register the `DbContext` via `AddDbContext`,
model in `OnModelCreating`, and **above all** never let the schema drift by hand: every
change goes through a versioned migration.

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

You then generate the migration with `dotnet ef migrations add InitialCreate`, and apply it
on startup with `db.Database.MigrateAsync()` — never `EnsureCreated`, which short-circuits
the whole history. The official docs cover the workflow in the
[EF Core migrations guide](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/).

## Typed results and validation

This is where Minimal APIs really shine. Rather than returning an opaque `IActionResult`,
you return a **typed results union**: the signature documents the possible HTTP codes, and
OpenAPI exposes them automatically.

```csharp
private static async Task<Results<Created<Todo>, ValidationProblem>> CreateAsync(
    CreateTodoRequest request, AppDbContext db)
{
    if (string.IsNullOrWhiteSpace(request.Title))
    {
        return TypedResults.ValidationProblem(new Dictionary<string, string[]>
        {
            ["title"] = ["Title is required."],
        });
    }

    var todo = new Todo { Title = request.Title };

    db.Todos.Add(todo);
    await db.SaveChangesAsync();

    return TypedResults.Created($"/todos/{todo.Id}", todo);
}
```

The return type `Results<Created<Todo>, ValidationProblem>` is **self-documenting**: no need
for redundant `[ProducesResponseType]` attributes.

## Keeping it testable

Once handlers are extracted into static methods that receive their dependencies as
parameters, they become trivial to test **without an HTTP server**: you instantiate an
`AppDbContext` on the in-memory or SQLite provider, call the handler, and inspect the
`TypedResults`. For end-to-end integration tests, `WebApplicationFactory<T>` spins up the
full application in memory and lets you hit the real endpoints.

> A Minimal API isn't a budget API. Well split into groups and typed results, it exposes
> **less ceremony for more guarantees** — which is exactly what you want from a modern
> framework.
