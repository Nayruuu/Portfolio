On hereda pocas veces un proyecto virgen. Lo más habitual es un monolito .NET en producción
desde hace ocho años, que nadie relee de un tirón y que el equipo teme tocar. El reflejo
es reclamar su reescritura completa. El patrón **Strangler Fig**, descrito por
[Martin Fowler](https://martinfowler.com/bliki/StranglerFigApplication.html), propone lo contrario:
rodear el monolito y luego reemplazarlo una funcionalidad a la vez, hasta que no quede
nada que apagar.

## Por qué no una reescritura de golpe

La reescritura completa apunta a un objetivo móvil. Durante los meses en que el equipo reconstruye, el
monolito sigue entregando correcciones y funcionalidades que la nueva versión deberá
alcanzar antes incluso de existir.

El día del cambio, todo ocurre a la vez. La menor regresión afecta a todo el
producto, y volver atrás significa redesplegar el sistema antiguo entero.

El strangler desplaza el riesgo. En lugar de un cambio único e irreversible, se obtiene una
serie de pequeños cambios, cada uno limitado a una ruta, cada uno reversible. La reescritura no avanza
más rápido, pero produce valor en cada etapa sin poner nunca en juego el producto entero.

## Primero la fachada

Antes de extraer nada, se coloca un punto de intercepción delante del monolito. Un
reverse proxy recibe todo el tráfico y lo reenvía, por ahora, al código antiguo sin excepción.
Funcionalmente, este primer despliegue no cambia nada, y es precisamente eso lo que lo hace seguro de
publicar.

Este punto de intercepción es la pieza clave del patrón. Mientras no exista, desviar una
ruta obliga a modificar el propio monolito. Una vez implantado, el cambio de una funcionalidad
se resuelve en una línea de configuración, sin recompilar el código antiguo.

En .NET, [YARP](https://microsoft.github.io/reverse-proxy/) cumple ese papel dentro del proceso,
gobernado por configuración. La ruta más específica gana: `/orders/...` va hacia el
nuevo servicio, y el comodín devuelve el resto al monolito.

```json
{
  "ReverseProxy": {
    "Routes": {
      "orders-v2": { "ClusterId": "orders-service", "Match": { "Path": "/orders/{*rest}" } },
      "legacy":    { "ClusterId": "monolith",       "Match": { "Path": "/{*rest}" } }
    },
    "Clusters": {
      "orders-service": { "Destinations": { "d1": { "Address": "https://orders.internal/" } } },
      "monolith":       { "Destinations": { "d1": { "Address": "https://legacy.internal/" } } }
    }
  }
}
```

## Elegir la primera costura

No todas las funcionalidades son buenas candidatas para la primera extracción. Se busca
un **contexto delimitado** (bounded context) en el sentido de [Domain-Driven Design](https://martinfowler.com/bliki/BoundedContext.html):
un conjunto coherente, con una frontera nítida y pocas dependencias que la atraviesen.

El buen primer candidato está débilmente acoplado al resto: pocas tablas compartidas, pocas llamadas
cruzadas con el núcleo del monolito. También duele en algún punto, ya sea porque cambia
a menudo, ya sea porque soporta una carga que el código antiguo asume mal.

Se evita lo contrario, el módulo central al que todos llaman o la tabla sobre la que la mitad
de las consultas hacen un join. Rara vez se extrae la facturación primero. Se empieza por una
costura periférica donde el fallo queda contenido: un catálogo de solo lectura, un servicio de
notificaciones, una exportación.

## La anti-corruption layer

El nuevo servicio nunca debe hablar el lenguaje del legacy. Columnas en mayúsculas, códigos
de estado numéricos, fechas sin zona horaria: estas decisiones heredadas no deben cruzar la
frontera y contaminar el modelo nuevo. Se interpone una **anti-corruption layer**, un término de Eric Evans, cuyo
único trabajo es traducir de un mundo al otro.

En la práctica, es una capa a la entrada del servicio. Toma el DTO tal como el monolito lo
produce y lo convierte en un modelo de dominio limpio, con sus tipos fuertes.

```csharp
// Translates the legacy contract into the new domain model. Nothing past this
// point knows the monolith's column names, status codes or naked timestamps.
public sealed class LegacyOrderTranslator
{
    public Order ToDomain(LegacyOrderDto dto) => new(
        Id: new OrderId(dto.ORDER_ID),
        Status: MapStatus(dto.STATUS_CODE),
        Total: Money.FromCents(dto.TOTAL_CENTS, dto.CURRENCY),
        PlacedAt: DateTime.SpecifyKind(dto.DT, DateTimeKind.Utc));

    private static OrderStatus MapStatus(int code) => code switch
    {
        10 => OrderStatus.Pending,
        20 => OrderStatus.Paid,
        30 => OrderStatus.Shipped,
        _ => throw new UnknownLegacyStatusException(code),
    };
}
```

La traducción va en ambos sentidos mientras el monolito siga siendo la fuente de verdad: el servicio lee
del legacy, aplica su lógica y luego reescribe en el formato que el código antiguo espera. Esta capa
es también el único lugar que conoce las rarezas del esquema antiguo. El día en que el legacy
desaparece, se elimina el traductor y nada más se mueve.

## Migrar la propiedad de los datos

Esta es la etapa que el proxy no resuelve. Enrutar una petición es sencillo; desplazar el dato
que lee y escribe lo es mucho menos.

Al principio, el servicio extraído a menudo comparte la base de datos del monolito. Lee y escribe las mismas
tablas, lo que evita cualquier sincronización pero hace convivir dos bases de código sobre el mismo
dato. Es un estado transitorio, aceptable mientras se estabiliza la ruta, no un
destino.

El objetivo es que la costura posea sus datos. El servicio recibe su propio almacenamiento y una de
las dos escrituras se convierte en la referencia. Para mantener la coherencia durante la transición, se escribe en
ambos lados (doble escritura), o, más seguro, se publican los cambios del monolito mediante un outbox
o mediante captura de cambios de datos (CDC) que el nuevo servicio consume.

## Cambiar, luego medir

Una ruta no pasa de golpe al 100 % del tráfico. Se empieza con un **canario**: una pequeña
fracción de las peticiones va hacia el nuevo servicio, el resto sigue en el monolito. Si los
errores y las latencias se mantienen, se aumenta la proporción, hasta cortar la ruta antigua.

Antes de cortar, se quiere la prueba de que el nuevo camino responde como el antiguo. El tráfico espejo
(shadow traffic) envía la misma petición a ambas implementaciones, sirve la respuesta del monolito al
usuario, y compara la del nuevo servicio en segundo plano sin exponerla nunca.

```csharp
// Shadow the request to the new service, keep serving the monolith's answer,
// and log any divergence for offline review. The user never sees v2 yet.
var legacy = await _monolith.GetOrderAsync(id, ct);

_ = Task.Run(async () =>
{
    var candidate = await _ordersV2.GetOrderAsync(id, ct);
    if (!OrderComparer.Equivalent(legacy, candidate))
    {
        _log.LogWarning("Shadow divergence on order {Id}", id);
    }
});

return legacy;
```

Las divergencias detectadas por esta comparación forman la lista de tareas antes del cambio. Cuando
se vacía, el canario puede subir sin apuesta.

## Retirar el camino antiguo

Una funcionalidad migrada deja atrás código legacy que ya no sirve. La tentación es
conservarlo por si acaso. Así es como un monolito estrangulado termina con dos implementaciones de
todo, sin eliminar ninguna.

La regla: solo se retira un camino cuando está **probadamente muerto**. La telemetría del proxy indica cuántas
llamadas siguen pasando por la ruta antigua. Mientras el contador no esté a cero en una ventana
representativa, el código permanece. Una vez a cero, se elimina la ruta legacy, luego el código que
servía, luego las columnas que ya nadie lee.

El monolito se reduce en cada costura retirada. El patrón termina por sí mismo: cuando la
última ruta ha cambiado, no queda nada que enrutar hacia el proceso antiguo, y se apaga.

> El strangler no acelera la reescritura, la hace reversible. Cada etapa entrega una costura
> detrás del proxy, se valida bajo tráfico espejo y se anula en una línea de configuración. El
> riesgo ya no se concentra en un único cambio, se reparte en una serie de pequeños pasos de los que
> cada uno puede fallar sin arrastrar consigo el producto.
