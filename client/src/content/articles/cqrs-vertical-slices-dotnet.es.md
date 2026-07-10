En cuanto alguien pronuncia **CQRS**, muchos equipos sacan la artillería pesada: event
sourcing, un bus de mensajes, dos bases de datos. Sin embargo, CQRS es ante todo una idea
modesta — **separar las lecturas de las escrituras** — que se puede aplicar sin ninguna
parafernalia, organizando el código por **vertical slices**.

## Dividir por funcionalidad, no por capa

La arquitectura en capas fragmenta una funcionalidad en cinco carpetas: `Controllers`,
`Services`, `Repositories`, `DTOs`, `Validators`. Para entender «crear una orden», hay que
saltar de archivo en archivo. La **vertical slice** invierte la lógica: una carpeta por
funcionalidad, todo lo que la concierne en el mismo lugar.

```bash
Features/
  Orders/
    CreateOrder.cs      # commande + handler + validateur
    GetOrderById.cs     # requête + handler
    ListOrders.cs
```

Cada slice es autónoma. Se lee de arriba a abajo, se elimina sin efectos secundarios, y dos
slices solo comparten el dominio — nunca un «servicio» cajón de sastre.

## Comando y consulta, dos intenciones distintas

Un **comando** modifica el estado y devuelve (idealmente) solo un identificador. Una
**consulta** no lee nada más que lo que la vista necesita, a menudo cortocircuitando el
dominio para proyectar directamente hacia un DTO. Modelarlos por separado clarifica la
intención:

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

El handler permanece **delgado**: orquesta, no razona. La lógica de negocio vive en
`Order.Create`, no en el handler — de lo contrario, simplemente habremos movido el «servicio»
a otro archivo.

## El mediador, opcional

A menudo se ve CQRS asociado a [MediatR](https://github.com/jbogard/MediatR). El mediador
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

Si la aplicación es pequeña, omitir el mediador y llamar al handler directamente sigue siendo
perfectamente legítimo — menos indirección, menos magia.

## No sobrediseñar

La pregunta que hay que hacerse en cada slice: **¿realmente necesito esto?** Bases de datos
separadas, proyecciones asíncronas, event sourcing — son respuestas a problemas de escala
precisos (lecturas masivamente superiores a las escrituras, auditoría inmutable). Sin ese
problema, solo añaden latencia y bugs de coherencia. El buen CQRS, en el 90 % de los casos,
es: comandos y consultas distintos, un único `DbContext`, slices legibles.

> CQRS no es una arquitectura, es una **disciplina de nomenclatura**. Separa las intenciones,
> mantén los handlers delgados, y no añadas un bus de mensajes hasta el día en que una métrica
> te obligue a ello.
