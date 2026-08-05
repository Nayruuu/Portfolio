Muchos equipos meten **CQRS** en el mismo cajón que el event sourcing, los buses de
mensajes y las bases de datos duplicadas. Sin embargo, la idea de partida es modesta: separar el
camino de las lecturas del de las escrituras. Se aplica sin infraestructura adicional,
organizando el código por **vertical slices**, una funcionalidad por carpeta.

## Dividir por funcionalidad, no por capa

La arquitectura en capas fragmenta una funcionalidad en cinco carpetas: `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. Para seguir «crear un pedido» de principio a
fin, hay que saltar de archivo en archivo, y cada carpeta acaba mezclando fragmentos de
decenas de funcionalidades sin relación entre sí.

El **vertical slice** invierte el orden: una carpeta por caso de uso, todo lo relacionado con
él en el mismo lugar.

```bash
Features/
  Orders/
    CreateOrder.cs      # command + handler + validator
    GetOrderById.cs     # query + handler
    ListOrders.cs
```

Un slice contiene su request, su handler, el validador que le corresponde y el DTO que
devuelve. Se lee de arriba abajo y se elimina sin efectos secundarios: nada más depende de él.
Dos slices solo comparten el **dominio**, nunca un «service» cajón de sastre del que toda
la aplicación viene a servirse. Jimmy Bogard, quien popularizó el enfoque bajo el nombre de
[vertical slice architecture](https://www.jimmybogard.com/vertical-slice-architecture/), resume
la restricción que sostiene todo: lo que cambia junto vive junto.

## Comando y consulta, dos intenciones distintas

Un **comando** modifica el estado y lo ideal es que solo devuelva un identificador, o nada. Una
**consulta** solo lee lo que la vista necesita y no toca nada. Modelarlos como dos
tipos separados hace que la intención sea legible desde la propia firma.

La distinción no es nueva. Extiende el principio de **Command-Query Separation** de
Bertrand Meyer, según el cual un método cambia el estado o devuelve un valor, nunca ambas cosas.
Greg Young lo convirtió en una sigla, CQRS, llevando la idea a la escala de un modelo entero en
lugar de un método.

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

El handler se mantiene **delgado**: orquesta, no razona. La lógica de negocio vive en
`Order.Create`, donde el agregado protege sus invariantes. Si esta migra al handler, solo se ha
renombrado el «service» del que se quería huir.

Un handler así de plano se prueba sin ceremonias: recibe sus dependencias como parámetros, se
instancia con un `AppDbContext` sobre SQLite o el proveedor in-memory, se llama a `Handle`, se
inspecciona el resultado. Sin servidor HTTP que levantar, sin pipeline que simular.

## Dos modelos de datos para dos necesidades

Es en el lado de lectura donde la separación da sus frutos, incluso con una sola base de datos.
El lado de escritura pasa por el agregado porque debe validar reglas antes de mutar el estado.
El lado de lectura no tiene ninguna razón para reconstruir ese agregado: proyecta directamente
la tabla hacia el DTO esperado por quien la llama.

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

`AsNoTracking` desactiva el change tracker, innecesario para una lectura, y el `Select` deja que
EF Core genere un `SELECT` que solo trae las columnas proyectadas. La consulta ya no queda
prisionera de la forma del modelo de escritura: ensambla exactamente la vista deseada, sumas y
joins incluidos.

El día en que las lecturas se conviertan en el cuello de botella, ese mismo slice se convierte en
el punto de enganche para conectar Dapper, SQL en bruto o una tabla desnormalizada, sin tocar el
lado de escritura. Nada obliga a hacerlo mientras una métrica no lo exija.

## El mediador, un detalle de implementación

CQRS suele venir pegado a [MediatR](https://github.com/jbogard/MediatR). El mediador desacopla
el endpoint del handler y ofrece un punto de enganche para los **pipeline behaviors**. Un
endpoint se limita entonces a enviar el mensaje: `await sender.Send(command)` devuelve el
identificador, que se envuelve en un `TypedResults.Created`.

Práctico, pero aparte: nada en CQRS impone un mediador. Se puede inyectar el handler
directamente en el endpoint y llamarlo a mano. MediatR, además, pasó a licencia
comercial, lo que hace que la opción propia sea más seria que antes: un dispatcher que resuelve
`IRequestHandler<,>` en el contenedor y llama a `Handle` cabe en una quincena de líneas. En
una aplicación pequeña, esa indirección de menos suele merecer la pena.

El propio endpoint puede vivir en el archivo del slice, expuesto mediante un método de extensión
`MapCreateOrder` que el `Program.cs` se limita a invocar como un `MapGroup`. La ruta, el
comando y el handler caben entonces en el mismo archivo, y nada de la funcionalidad queda
disperso en otro lugar.

## Dónde colocar la validación y lo transversal

Validación, logging, apertura de transacción: estas preocupaciones se repiten en cada
slice. Copiarlas en cada handler es la mejor manera de olvidar alguna. Un **pipeline
behavior** las factoriza envolviendo todos los handlers de una vez.

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

Cada slice declara su [validador FluentValidation](https://docs.fluentvalidation.net/), el
behavior lo recupera por inyección y lo dispara antes del handler. Registrado una sola vez
mediante `AddOpenBehavior(typeof(ValidationBehavior<,>))`, cubre comandos y consultas sin código
repetido.

El behavior tiene un coste: es flujo de control invisible. Hacen falta pocos, cada uno
claramente delimitado, o se acaba recreando la magia que se le reprochaba al mediador.

## No sobrediseñar

La pregunta que hay que hacerse ante cada slice sigue siendo la misma: **¿de verdad lo
necesito?** Bases separadas, proyecciones asíncronas, event sourcing responden a problemas
concretos: lecturas masivamente superiores a las escrituras, auditoría inmutable, modelo de
lectura muy alejado del modelo de escritura. En ausencia de ese problema, solo añaden latencia y
bugs de consistencia diferida.

El CQRS útil, en la inmensa mayoría de los casos: comandos y consultas separados, un
único `DbContext`, slices que se leen sin grep. El resto espera una razón cuantificada.

> CQRS empieza siendo una disciplina de nombrado antes que una arquitectura. Separe las
> intenciones, mantenga los handlers delgados, deje que las lecturas atajen el dominio, y
> no añada un bus de mensajes hasta el día en que una métrica lo obligue.
