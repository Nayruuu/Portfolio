## Tres señales, una sola API

OpenTelemetry unifica los tres pilares de la observabilidad. Las **trazas** siguen una petición
de extremo a extremo mediante una serie de spans correlacionados por un `trace_id`. Las **métricas** agregan
contadores e histogramas (tasa de peticiones, latencia p95). Los **logs** aportan el
contexto textual, ahora vinculado al `trace_id` actual. .NET expone de forma nativa estos
conceptos a través de `System.Diagnostics.Activity` (los spans) y `System.Diagnostics.Metrics`.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("api-super-dev"))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter())
    .WithMetrics(m => m
        .AddAspNetCoreInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter());
```

## Auto-instrumentación vs spans manuales

La **auto-instrumentación** cubre gratuitamente lo esencial: `AddAspNetCoreInstrumentation`
crea un span por petición entrante, `AddHttpClientInstrumentation` propaga el contexto en las
llamadas salientes — la correlación entre servicios se realiza automáticamente a través de las cabeceras
`traceparent` del estándar W3C. Para la lógica de negocio, se añaden **spans manuales** para
medir una operación concreta y adjuntarle atributos de negocio.

```csharp
private static readonly ActivitySource Source = new("SuperDev.Orders");

public async Task<Order> PlaceOrderAsync(Cart cart)
{
    using var activity = Source.StartActivity("place-order");
    activity?.SetTag("order.items", cart.Items.Count);
    activity?.SetTag("order.total", cart.Total);

    var order = await _repository.SaveAsync(cart);
    activity?.SetTag("order.id", order.Id);

    return order;
}
```

Los atributos (`SetTag`) transforman una traza en herramienta de depuración: se filtra por
`order.total > 1000` o se identifica el span exacto que disparó la latencia.

## El exportador OTLP y el Collector

**OTLP** (OpenTelemetry Protocol) es el formato de transporte común. En lugar de exportar
directamente a un backend, se envía todo al **Collector**: un proceso intermedio que
recibe, transforma (batching, muestreo, filtrado de atributos sensibles) y redistribuye
hacia uno o varios destinos. La app solo conoce **un** endpoint; cambiar de backend
se convierte en una modificación de configuración en el Collector, no en un redespliegue.

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

La app apunta al Collector mediante `OTEL_EXPORTER_OTLP_ENDPOINT`, una variable
de entorno estándar. La [documentación de OpenTelemetry](https://opentelemetry.io/docs/languages/net/)
cubre el muestreo (`ParentBased`, `TraceIdRatioBased`) imprescindible en producción para no verse
desbordado por el volumen de trazas.

> Instrumentar con OpenTelemetry es desacoplar el código de la herramienta de monitorización. El día
> que se migra de Jaeger a Azure Monitor, **no se toca ni una sola línea de la app**: se cambia
> el exportador del Collector.
