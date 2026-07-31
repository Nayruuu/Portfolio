Muchos equipos asocian **CQRS** con el event sourcing, los buses de mensajes, las bases de
datos separadas. La idea de partida es, sin embargo, modesta: **separar las lecturas de las
escrituras**. Se aplica sin complicaciones innecesarias, organizando el código por
**vertical slices**.

## Dividir por funcionalidad, no por capa

La arquitectura en capas fragmenta una funcionalidad en cinco carpetas: `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. Para entender «crear un pedido», hay que
saltar de archivo en archivo. La **vertical slice** invierte la lógica: una carpeta por
funcionalidad, todo lo relacionado con ella en el mismo lugar.

```bash
Features/
  Orders/
    CreateOrder.cs      # command + handler + validator
    GetOrderById.cs     # query + handler
    ListOrders.cs
```

Cada slice es autónoma: se lee de arriba abajo y se elimina sin efectos secundarios.
Dos slices solo comparten el dominio, nunca un «servicio» genérico.

## Comando y consulta, dos intenciones distintas

Un **comando** modifica el estado y devuelve (idealmente) solo un identificador. Una **consulta**
no lee nada más que lo que la vista necesita, a menudo evitando el dominio para
proyectar directamente hacia un DTO. Modelarlos por separado clarifica la intención:

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

El handler se mantiene **delgado**: orquesta, sin razonar. La lógica de negocio vive en
`Order.Create`, no en el handler. De lo contrario, solo hemos trasladado el «servicio» a otro
archivo.

## El mediador, opcional

A menudo se ve CQRS pegado a [MediatR](https://github.com/jbogard/MediatR). El mediador
desacopla el endpoint del handler y ofrece un punto de enganche para los **pipeline behaviors**
(validación, logging, transacción). Es práctico, pero **no** es CQRS: se puede perfectamente
inyectar el handler directamente.

```csharp
group.MapPost("/", async (CreateOrder command, ISender sender) =>
{
    var id = await sender.Send(command);

    return TypedResults.Created($"/orders/{id}", new { id });
});
```

Si la aplicación es pequeña, saltarse el mediador y llamar al handler a mano sigue siendo
legítimo: se elimina una capa de indirección y la magia que la acompaña.

## No sobrediseñar

La pregunta que hay que hacerse en cada slice: **¿realmente necesito esto?** Bases separadas,
proyecciones asíncronas, event sourcing responden a problemas de escala precisos (lecturas
muy superiores a las escrituras, auditoría inmutable). Sin ese problema, solo añaden
latencia y bugs de coherencia.

El buen CQRS, en el 90 % de los casos: comandos y consultas distintos, un solo
`DbContext`, slices legibles.

> CQRS es una **disciplina de nomenclatura** antes que una arquitectura. Separa las
> intenciones, mantén los handlers delgados, y añade un bus de mensajes solo el día en que una
> métrica te obligue a ello.
