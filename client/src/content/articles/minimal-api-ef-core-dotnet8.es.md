Los **Minimal APIs** de .NET 8 eliminan el `Controller`, el enrutamiento por atributos y buena
parte de la plomería de enlace. Un endpoint se convierte en un método que recibe sus dependencias
como parámetros. El riesgo es conocido: sin una buena estructura, todo termina apilado en
`Program.cs`. A continuación se muestra una API respaldada por EF Core que se mantiene legible y
testeable a medida que crece.

## Dividir en grupos de rutas

La primera herramienta útil es **`MapGroup`**. Cada recurso obtiene su prefijo, sus filtros y sus
metadatos, agrupados en un método de extensión. Los handlers siguen siendo métodos estáticos, lo
que facilita aislarlos después.

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

En `Program.cs`, solo queda un `app.MapTodos();` por recurso. `WithTags` alimenta la
documentación, `WithOpenApi` enriquece cada endpoint generado. El grupo también acepta un
`AddEndpointFilter` que se aplica de una vez a todas sus rutas, lo cual sirve para la autorización
o la validación común.

La restricción `{id:int}` de la plantilla trabaja desde el enrutamiento: una petición `/todos/abc`
no encuentra ninguna ruta que coincida y responde 404 sin llegar nunca al handler. Poner las
restricciones en la plantilla en lugar de en el cuerpo evita un `int.TryParse` defensivo al
comienzo de cada método.

## Resultados tipados

`Results.Ok(...)` devuelve un `IResult` opaco. `TypedResults.Ok(...)` devuelve un `Ok<T>`
concreto, y esta diferencia desbloquea las uniones de resultados. Una firma como
`Results<Ok<TodoDto>, NotFound>` declara los dos desenlaces posibles: el compilador verifica que
el handler no devuelva nada más, y OpenAPI publica ambos códigos HTTP sin necesidad del más
mínimo atributo `[ProducesResponseType]`.

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

Cada rama vuelve por conversión implícita al tipo de unión. Añadir un código, un `401` por
ejemplo, se hace ampliando la firma de retorno, y el cuerpo del handler deja de compilar mientras
ese caso no esté tratado. Es una restricción útil: el contrato HTTP vive en el tipo, no en un
comentario.

## Enlace de modelo y validación

El enlace de los parámetros sigue reglas fijas, la mayoría de las veces sin atributo. Un `int id`
que corresponde a un segmento de ruta viene de la URL, un tipo primitivo sin correspondencia
viene de la query string, un tipo complejo viene del cuerpo JSON, y un servicio registrado en el
contenedor se inyecta directamente. Cuando la firma se alarga, `[AsParameters]` agrupa varios
parámetros en un `struct` dedicado.

En .NET 8, los Minimal APIs **no validan** los atributos DataAnnotations por sí solos. Un
`[Required]` puesto en una propiedad del DTO se ignora en el binding. Dos caminos: validar a mano
en el handler, como a continuación, o conectar un `AddEndpointFilter` que inspecciona el
argumento vía `context.GetArgument<CreateTodoRequest>(0)` y devuelve un `ValidationProblem` sin
llamar a `next` cuando el modelo es inválido. FluentValidation se engancha en el mismo lugar.

`TypedResults.ValidationProblem` responde un `400` con el formato ProblemDetails (RFC 7807), el
mismo cuerpo que produciría automáticamente un controlador anotado con `[ApiController]`. El
cliente ve entonces la misma estructura de error, ya sea que toque una ruta Minimal API o un
controlador clásico.

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

## EF Core: DbContext, consultas, migraciones

`AddDbContext<AppDbContext>` registra el contexto con una vida útil **scoped**: una instancia por
petición HTTP, inyectada en el handler como cualquier otro servicio. Esta elección no es
cosmética: un `DbContext` no es thread-safe y no debe compartirse entre peticiones, y el alcance
scoped garantiza exactamente ese aislamiento. Para caudales elevados, `AddDbContextPool` recicla
las instancias en lugar de asignar una nueva en cada llamada.

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
```

En lectura, `AsNoTracking` desactiva el seguimiento de cambios: EF Core no construye snapshots
para comparar más tarde, lo cual aligera las consultas que solo devuelven datos. El `Select`
hacia un `record TodoDto` va más lejos: limita las columnas realmente cargadas en lugar de
materializar la entidad completa antes de mapearla en memoria. Es la diferencia entre un
`SELECT Id, Title, IsDone` y un `SELECT *` seguido de una proyección del lado del cliente.

En escritura, `db.Todos.Add(entity)` seguido de un único `SaveChangesAsync` validan la
transacción. EF Core emite el `INSERT` y recupera la clave generada en `entity.Id`, disponible de
inmediato para construir la URL del `Created`.

El esquema se gestiona mediante migraciones: `dotnet ef migrations add InitialCreate` produce un
archivo versionado, aplicado al inicio con `db.Database.MigrateAsync()`. `EnsureCreated` sí crea
las tablas pero ignora por completo el historial de migraciones, lo cual hace imposible la
primera migración real después; hay que reservarlo para bases desechables. El flujo completo se
describe en la [guía de migraciones de EF Core](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/).

## Minimal API o controlador

Los Minimal APIs cubren bien las API JSON, los servicios internos, los backends de SPA y las
funciones de superficie reducida. Los controladores mantienen la ventaja cuando se apoya uno en
`[ApiController]` y su validación automática, en los filtros MVC (acción, resultado, excepción),
en el model binding rico de formularios, o en convenciones de equipo ya establecidas.

Ambos estilos conviven en la misma aplicación. Nada obliga a decidir globalmente: se puede
exponer un recurso como Minimal API y conservar un controlador allí donde su tooling todavía
resulte útil.

## Mantenerlo todo testeable

Los handlers estáticos que reciben sus dependencias como parámetros se prueban **sin servidor
HTTP**: se instancia un `AppDbContext` sobre el proveedor SQLite in-memory, se llama al handler,
se inspecciona el resultado. `TypedResults` ayuda también aquí, ya que el tipo de retorno
concreto expone directamente el `StatusCode` y el valor, sin necesidad de deserializar una
respuesta.

Para el extremo a extremo, `WebApplicationFactory<Program>` arranca la aplicación en memoria y
deja golpear los endpoints reales a través de un `HttpClient`, filtros y enlace incluidos. Con
top-level statements, la clase `Program` generada es interna: un `public partial class Program { }`
al final del archivo basta para hacerla visible desde el proyecto de pruebas.

> Un Minimal API bien llevado no tiene nada de prototipo. El estilo quita la ceremonia heredada de
> los controladores; el diseño, en cambio, sigue siendo enteramente responsabilidad suya.
