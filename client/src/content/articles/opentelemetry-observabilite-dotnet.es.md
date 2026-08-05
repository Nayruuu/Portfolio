Quando una petición atraviesa tres servicios y se demora, los logs por sí solos no dicen
**dónde**. Cuentan cada servicio en un compartimento aislado, sin el hilo que los conecta. La observabilidad
se apoya en tres señales correlacionadas (traces, métricas, logs), y **OpenTelemetry** es su
estándar vendor-neutral: se instrumenta una vez, se exporta a cualquier backend
(Jaeger, Prometheus, Azure Monitor) sin reescribir el código de la aplicación.

## Tres señales, una misma plomería

En .NET, OpenTelemetry no reinventa nada: se conecta a primitivas ya presentes
en el BCL. Un **trace** sigue una petición de principio a fin mediante una serie de spans conectados por
un `trace_id`, y en .NET un span es una `System.Diagnostics.Activity`. Las **métricas**
agregan contadores e histogramas (tasa de peticiones, latencia p95) a través de un
`System.Diagnostics.Metrics.Meter`. Los **logs** pasan por `ILogger`, ahora vinculados al
`trace_id` del contexto actual.

El SDK es, por tanto, sobre todo un *listener*: escucha las `Activity` y los `Meter` que su código
y las bibliotecas ya producen, y luego los exporta. Se instala mediante el paquete
`OpenTelemetry.Extensions.Hosting` y se conecta al arrancar.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("api-super-dev"))
    .WithTracing(t => t
        .AddSource("SuperDev.Orders")            // custom ActivitySource
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter())
    .WithMetrics(m => m
        .AddMeter("SuperDev.Orders")             // custom Meter
        .AddAspNetCoreInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter());

// logs travel through the standard ILogger pipeline
builder.Logging.AddOpenTelemetry(o => o.AddOtlpExporter());
```

`ConfigureResource` fija el `service.name` que identifica la app en el backend. El resto
declara qué se escucha y a dónde se envía.

## Auto-instrumentación y spans manuales

La auto-instrumentación cubre lo esencial sin escribir código. `AddAspNetCoreInstrumentation`
crea un span por cada petición entrante; `AddHttpClientInstrumentation` crea uno por cada llamada saliente
e inyecta el contexto en ella. Estas instrumentaciones siguen las *semantic conventions*
de OpenTelemetry: los atributos llevan nombres normalizados (`http.request.method`, `url.path`,
`http.response.status_code`), lo que hace que un trace sea legible sin importar el backend.

Para la lógica de negocio, se añaden spans manuales. Aquí acecha una trampa clásica: una
`ActivitySource` propia no produce nada mientras su nombre no esté declarado vía `AddSource`.
Sin esa línea (presente en la configuración de arriba), `StartActivity` devuelve `null` y el span
desaparece en silencio.

```csharp
private static readonly ActivitySource Source = new("SuperDev.Orders");

public async Task<Order> PlaceOrderAsync(Cart cart)
{
    using var activity = Source.StartActivity("place-order");
    activity?.SetTag("order.items", cart.Items.Count);
    activity?.SetTag("order.total", cart.Total);

    try
    {
        var order = await _repository.SaveAsync(cart);
        activity?.SetTag("order.id", order.Id);
        return order;
    }
    catch (Exception ex)
    {
        activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
        throw;
    }
}
```

El `?.` no es una prudencia decorativa: cuando ningún listener muestrea el span,
`StartActivity` devuelve `null`, y el código debe continuar sin inmutarse. Los atributos
(`SetTag`) convierten el trace en una herramienta de depuración: se filtra por `order.total > 1000`, se
localiza el span exacto que disparó la latencia, y `SetStatus(Error)` marca el trace como
defectuoso para que suba a lo más alto de las búsquedas.

## Contar con las métricas

Un trace muestreado pierde peticiones; una métrica, no. Para una tasa o un p95 fiables,
se cuenta todo mediante un `Meter`. En ASP.NET Core, se obtiene por inyección con `IMeterFactory`
en lugar de un campo estático, lo que deja que el SDK gestione su ciclo de vida.

```csharp
public sealed class OrderMetrics
{
    private readonly Counter<long> _placed;
    private readonly Histogram<double> _amount;

    public OrderMetrics(IMeterFactory factory)
    {
        var meter = factory.Create("SuperDev.Orders");
        _placed = meter.CreateCounter<long>("orders.placed");
        _amount = meter.CreateHistogram<double>("orders.amount", unit: "EUR");
    }

    public void Record(Order order)
    {
        _placed.Add(1, new KeyValuePair<string, object?>("order.channel", order.Channel));
        _amount.Record(order.Total);
    }
}
```

El nombre `SuperDev.Orders` debe corresponder al `AddMeter` de la configuración, la misma regla que para los
traces. Cuidado con la elección de las dimensiones: `order.channel` toma pocos valores, pero un
`order.id` como tag haría explotar la cardinalidad, porque cada valor distinto crea una serie
temporal. Los identificadores únicos tienen su lugar en un span, nunca en un contador.

En cuanto a los logs, el puente OpenTelemetry adjunta automáticamente el `trace_id` y el `span_id` del
contexto a cada entrada de `ILogger`. Desde un span lento, se salta entonces a los logs exactos de
esa petición, sin necesidad de un grep sobre una marca de tiempo aproximada.

## Propagar el contexto entre servicios

La correlación entre servicios se apoya en un estándar, el **W3C Trace Context**.
`AddHttpClientInstrumentation` serializa el contexto actual en la cabecera `traceparent`
(con la forma `00-{trace_id}-{span_id}-{flags}`), y la instrumentación ASP.NET Core del servicio
llamado la vuelve a leer para vincular su span al padre correcto. No hay nada que cablear mientras se permanezca en HTTP.

Fuera de HTTP, el enlace se pierde. Un mensaje colocado en una cola (Service Bus, Kafka) no transporta
cabecera HTTP: hay que inyectar el `traceparent` en las propiedades del mensaje al enviarlo,
y luego volver a extraerlo en la recepción, vía `Propagators.DefaultTextMapPropagator`. El **baggage**
toma el mismo canal para propagar pares clave/valor de negocio (un `tenant.id`, por ejemplo)
a lo largo de toda la cadena de llamadas.

## OTLP, el Collector y el muestreo

**OTLP** (OpenTelemetry Protocol) es el formato de transporte común, en gRPC por el puerto 4317
o en HTTP por el 4318. En lugar de exportar directamente a un backend, se envía todo al
**Collector**: un proceso intermedio que recibe, transforma (batching, filtrado de
atributos sensibles, muestreo) y redistribuye hacia uno o varios destinos. La app
solo conoce un endpoint, ajustado por la variable estándar `OTEL_EXPORTER_OTLP_ENDPOINT`;
cambiar de backend se convierte en una modificación de configuración del lado del Collector, no en un redespliegue.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
processors:
  batch:
    timeout: 5s
exporters:
  prometheus:
    endpoint: 0.0.0.0:8889
  otlp/jaeger:
    endpoint: jaeger:4317
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

Queda el muestreo, indispensable en producción para no exportar cada trace. El SDK gestiona
un muestreo *head-based*: `SetSampler(new ParentBasedSampler(new
TraceIdRatioBasedSampler(0.1)))` conserva el 10 % de los traces respetando la decisión ya
tomada aguas arriba, de modo que un padre muestreado conserva a sus hijos y un trace se mantiene
coherente de un servicio a otro. Para conservar solo los traces interesantes (errores, latencia
alta), se traslada la decisión a *tail-based* en el Collector vía el processor
`tail_sampling`, una vez recibido el trace completo. La
[documentación de OpenTelemetry para .NET](https://opentelemetry.io/docs/languages/net/) detalla
las dos estrategias.

> Instrumentar con OpenTelemetry desacopla el código de la herramienta de monitorización. El SDK de .NET se
> limita a escuchar las `Activity` y los `Meter` que el runtime ya produce; migrar de
> Jaeger a Azure Monitor se resuelve del lado del Collector, sin tocar el código de la aplicación.
