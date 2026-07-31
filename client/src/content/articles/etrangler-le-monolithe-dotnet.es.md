Rara vez se hereda un **greenfield**. Lo más habitual es un monolito .NET que lleva
ocho años en producción y que nadie se atreve a tocar. El patrón **Strangler Fig** permite
reemplazarlo **pieza por pieza**, sin big bang y sin ventana de corte.

## El principio

Se coloca una fachada delante del monolito y luego se redirigen las rutas, una a una,
hacia un servicio nuevo. Mientras una funcionalidad no se haya reescrito, sigue pasando
por el código antiguo. El día en que se migra la última ruta, ya nada pasa por el
monolito: se puede apagar.

### Una anti-corruption layer

El código nuevo nunca debe hablar el lenguaje del legacy. Se interpone una
**anti-corruption layer** que traduce los modelos del mundo antiguo al nuevo:

```csharp
public sealed class LegacyOrderTranslator
{
    public Order ToDomain(LegacyOrderDto dto) => new(
        Id: new OrderId(dto.ORDER_ID),
        Total: Money.FromCents(dto.TOTAL_CENTS),
        PlacedAt: DateTime.SpecifyKind(dto.DT, DateTimeKind.Utc));
}
```

## Enrutar al nivel adecuado

El cambio se hace idealmente a nivel del **reverse proxy** (YARP, Nginx) y no en
el código, para mantener aislados los dos mundos. Con [YARP](https://microsoft.github.io/reverse-proxy/),
una simple ruta de configuración basta para desviar un camino hacia el servicio nuevo.

- una ruta migrada → servicio nuevo
- una ruta sin migrar → monolito
- un canary → 5 % del tráfico, luego 100 %

## Medir antes de cortar

Cada ruta migrada se duplica con un **shadow traffic** que se compara con la respuesta
antigua antes del corte definitivo. El código antiguo solo se elimina una vez **probada
su muerte**: mientras una llamada siga pasando por él, se queda. La telemetría arbitra
la migración.

> El strangler no acelera la reescritura, la hace **reversible**: en cada etapa,
> se puede volver atrás con una línea de configuración.
