## Estructurar con route groups

La trampa del principiante es apilar treinta `app.MapGet` en el `Program.cs`. La solución
se resume en una palabra: **`MapGroup`**. Cada recurso tiene su grupo, con su prefijo, sus
filtros y sus metadatos, definido en un método de extensión dedicado:

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

El `Program.cs` se reduce entonces a `app.MapTodos();` — un punto de entrada por recurso, el
resto vive en archivos coherentes.

## DbContext y migraciones

EF Core sigue siendo la columna vertebral del acceso a datos. Se registra el `DbContext` mediante
`AddDbContext`, se modela en `OnModelCreating`, y **sobre todo** nunca se deja que el
esquema derive manualmente: cada cambio pasa por una migración versionada.

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

Luego se genera la migración con `dotnet ef migrations add InitialCreate`, y se
aplica al arranque con `db.Database.MigrateAsync()` — nunca `EnsureCreated`, que
cortocircuita todo el historial. La documentación oficial detalla el flujo de trabajo en la
[guía de migraciones de EF Core](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/).

## Resultados tipados y validación

Aquí es donde las Minimal APIs realmente ganan terreno. En lugar de devolver un `IActionResult`
opaco, se retorna una **unión de resultados tipados**: la firma documenta los códigos HTTP
posibles, y OpenAPI los expone automáticamente.

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

El tipo de retorno `Results<Created<Todo>, ValidationProblem>` es **autodocumentado**: no
hacen falta atributos `[ProducesResponseType]` redundantes.

## Mantener todo testeable

Una vez que los handlers se extraen en métodos estáticos que reciben sus dependencias como
parámetros, se vuelven triviales de testear **sin servidor HTTP**: se instancia un
`AppDbContext` sobre el proveedor in-memory o SQLite, se llama al handler y se inspecciona el
`TypedResults`. Para los tests de integración de extremo a extremo, `WebApplicationFactory<T>`
levanta la aplicación completa en memoria y permite invocar los endpoints reales.

> Una Minimal API no es una API de segunda categoría. Bien estructurada en grupos y en resultados
> tipados, expone **menos ceremonia para más garantías** — y eso es exactamente lo que se espera
> de un framework moderno.
