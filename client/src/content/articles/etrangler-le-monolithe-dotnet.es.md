Rara vez se hereda un **greenfield**. Lo más frecuente es un monolito .NET que lleva ocho años en producción y que nadie se atreve a tocar. El patrón **Strangler Fig** permite reemplazarlo **pieza por pieza**, sin big-bang y sin ventana de corte.

## El principio

Se coloca una fachada delante del monolito y luego se **redirige** una ruta a la vez hacia un nuevo servicio. Mientras una funcionalidad no haya sido reescrita, sigue pasando por el código antiguo. El día en que la última ruta cambia, el monolito está muerto — estrangulado.

### Una anti-corruption layer

El nuevo código nunca debe hablar el lenguaje del legacy. Se interpone una **anti-corruption layer** que traduce los modelos del mundo antiguo al nuevo:

```csharp
public sealed class LegacyOrderTranslator
{
    public Order ToDomain(LegacyOrderDto dto) => new(
        Id: new OrderId(dto.ORDER_ID),
        Total: Money.FromCents(dto.TOTAL_CENTS),
        PlacedAt: DateTime.SpecifyKind(dto.DT, DateTimeKind.Utc));
}
```

## Enrutar en el nivel correcto

El cambio se realiza idealmente en el nivel del **reverse proxy** (YARP, Nginx) y no en el código, para mantener los dos mundos perfectamente aislados. Con [YARP](https://microsoft.github.io/reverse-proxy/), una simple ruta de configuración es suficiente para desviar un camino hacia el nuevo servicio.

- una ruta migrada → nuevo servicio
- una ruta no migrada → monolito
- un canary → 5 % del tráfico, luego 100 %

## Medir antes de cortar

Cada ruta migrada se acompaña de un **shadow traffic** comparado con la respuesta anterior antes de cortar definitivamente. El código antiguo solo se elimina cuando está **probado muerto**: mientras una llamada todavía pase por él, permanece. La telemetría se convierte entonces en el árbitro de la migración.

> Estrangular no es reescribir más rápido. Es reescribir de forma **reversible**: en cada etapa, se puede volver atrás con una sola línea de configuración.
