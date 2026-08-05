.NET 8's **Minimal APIs** remove the `Controller`, attribute routing, and a good deal of the
binding plumbing. An endpoint becomes a method that receives its dependencies as parameters. The
risk is well known: without proper structuring, everything ends up piled into `Program.cs`. What
follows shows an API backed by EF Core that stays readable and testable as it grows.

## Splitting into route groups

The first useful tool is **`MapGroup`**. Each resource gets its prefix, its filters, and its
metadata, grouped in an extension method. Handlers remain static methods, which keeps them easy to
isolate later on.

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

In `Program.cs`, all that's left is a single `app.MapTodos();` per resource. `WithTags` feeds the
documentation, `WithOpenApi` enriches each generated endpoint. The group also accepts an
`AddEndpointFilter` that applies at once to all its routes, which is useful for authorization or
shared validation.

The `{id:int}` constraint in the template does its work right at routing time: a `/todos/abc`
request matches no route and returns a 404 without ever reaching the handler. Putting the
constraints in the template rather than in the body avoids a defensive `int.TryParse` at the start
of every method.

## Typed results

`Results.Ok(...)` returns an opaque `IResult`. `TypedResults.Ok(...)` returns a concrete `Ok<T>`,
and that difference unlocks result unions. A signature like `Results<Ok<TodoDto>, NotFound>`
declares the two possible outcomes: the compiler checks that the handler returns nothing else, and
OpenAPI publishes both HTTP codes without a single `[ProducesResponseType]` attribute.

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

Each branch returns via implicit conversion to the union type. Adding a code, a `401` for
instance, is done by widening the return signature, and the body of the handler stops compiling
until that case is handled. This is a useful constraint: the HTTP contract lives in the type, not
in a comment.

## Model binding and validation

Parameter binding follows fixed rules, mostly without any attribute. An `int id` that matches a
route segment comes from the URL, a primitive type with no match comes from the query string, a
complex type comes from the JSON body, and a service registered in the container is injected
directly. When the signature grows too long, `[AsParameters]` groups several parameters into a
dedicated `struct`.

In .NET 8, Minimal APIs **do not validate** DataAnnotations attributes on their own. A `[Required]`
placed on a DTO property is ignored at binding time. There are two paths: validate by hand in the
handler, as below, or wire up an `AddEndpointFilter` that inspects the argument via
`context.GetArgument<CreateTodoRequest>(0)` and returns a `ValidationProblem` without calling
`next` when the model is invalid. FluentValidation plugs in at the same spot.

`TypedResults.ValidationProblem` responds with a `400` in ProblemDetails format (RFC 7807), the
same body a controller annotated `[ApiController]` would produce automatically. The client
therefore sees the same error structure, whether it hits a Minimal API route or a classic
controller.

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

## EF Core: DbContext, queries, migrations

`AddDbContext<AppDbContext>` registers the context with a **scoped** lifetime: one instance per
HTTP request, injected into the handler like any other service. This choice isn't cosmetic: a
`DbContext` isn't thread-safe and must not be shared across requests, and the scoped lifetime
guarantees exactly that isolation. For high-throughput scenarios, `AddDbContextPool` recycles
instances instead of allocating a fresh one on every call.

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

On reads, `AsNoTracking` disables change tracking: EF Core doesn't build snapshots to compare later,
which lightens queries that only return data. The `Select` into a `record TodoDto` goes further:
it limits the columns actually loaded instead of materializing the whole entity before mapping it
in memory. That's the difference between a `SELECT Id, Title, IsDone` and a `SELECT *` followed by
a client-side projection.

On writes, `db.Todos.Add(entity)` followed by a single `SaveChangesAsync` commits the transaction.
EF Core issues the `INSERT` and retrieves the generated key into `entity.Id`, immediately available
to build the `Created` URL.

The schema is driven by migrations: `dotnet ef migrations add InitialCreate` produces a versioned
file, applied at startup with `db.Database.MigrateAsync()`. `EnsureCreated` does create the tables
but completely ignores the migration history, which makes the first real migration impossible
afterward; reserve it for disposable databases. The full workflow is described in the
[EF Core migrations guide](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/).

## Minimal API or controller

Minimal APIs cover JSON APIs, internal services, SPA backends, and low-surface functions well.
Controllers keep the edge when you rely on `[ApiController]` and its automatic validation, on MVC
filters (action, result, exception), on rich form model binding, or on team conventions already in
place.

The two styles coexist within the same application. Nothing forces a global decision: you can
expose one resource as a Minimal API and keep a controller where its tooling still earns its keep.

## Keeping it all testable

Static handlers that receive their dependencies as parameters can be tested **without an HTTP
server**: instantiate an `AppDbContext` on the SQLite in-memory provider, call the handler, inspect
the result. `TypedResults` helps here too, since the concrete return type exposes the `StatusCode`
and the value directly, without deserializing a response.

For end-to-end testing, `WebApplicationFactory<Program>` starts the application in memory and lets
you hit the real endpoints through an `HttpClient`, filters and binding included. With top-level
statements, the generated `Program` class is internal: a `public partial class Program { }` at the
end of the file is enough to make it visible from the test project.

> A well-kept Minimal API is nothing like a prototype. The style removes the ceremony inherited
> from controllers; the design, however, remains entirely your responsibility.
