Wenn eine Anfrage drei Services durchläuft und langsam wird, sagen Logs allein nicht, **wo**.
Moderne Observability beruht auf drei korrelierten Signalen — Traces, Metriken, Logs — und
**OpenTelemetry** ist deren herstellerneutraler Standard: Man instrumentiert einmal und exportiert
in ein beliebiges Backend (Jaeger, Prometheus, Azure Monitor), ohne den Code neu zu schreiben.

## Drei Signale, eine einzige API

OpenTelemetry vereinheitlicht die drei Säulen der Observability. **Traces** verfolgen eine Anfrage
von Ende zu Ende über eine Folge von Spans, die durch eine `trace_id` korreliert sind. **Metriken**
aggregieren Zähler und Histogramme (Request-Rate, p95-Latenz). **Logs** liefern den textuellen
Kontext, der nun an die aktuelle `trace_id` gebunden ist. .NET stellt diese Konzepte nativ bereit
über `System.Diagnostics.Activity` (die Spans) und `System.Diagnostics.Metrics`.

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

## Auto-Instrumentation vs. manuelle Spans

Die **Auto-Instrumentation** deckt das Wesentliche kostenlos ab: `AddAspNetCoreInstrumentation`
erzeugt einen Span pro eingehender Anfrage, `AddHttpClientInstrumentation` propagiert den Kontext
bei ausgehenden Aufrufen — die serviceübergreifende Korrelation erfolgt automatisch über die
`traceparent`-Header des W3C-Standards. Für die Geschäftslogik fügt man **manuelle Spans** hinzu,
um eine konkrete Operation zu messen und ihr Business-Attribute anzuhängen.

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

Die Attribute (`SetTag`) verwandeln einen Trace in ein Debugging-Werkzeug: man filtert nach
`order.total > 1000` oder identifiziert den genauen Span, dessen Latenz explodiert ist.

## Der OTLP-Exporter und der Collector

**OTLP** (OpenTelemetry Protocol) ist das gemeinsame Transportformat. Statt direkt in ein Backend
zu exportieren, sendet man alles an den **Collector**: einen zwischengeschalteten Prozess, der
empfängt, transformiert (Batching, Sampling, Filterung sensibler Attribute) und an ein oder mehrere
Ziele weiterleitet. Die App kennt nur **einen** Endpoint; ein Backend-Wechsel wird zur
Konfigurationsänderung auf Collector-Seite, nicht zu einem Redeployment.

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

Die App zeigt über `OTEL_EXPORTER_OTLP_ENDPOINT`, eine Standard-Umgebungsvariable, auf den
Collector. Die [OpenTelemetry-Dokumentation](https://opentelemetry.io/docs/languages/net/)
behandelt das Sampling (`ParentBased`, `TraceIdRatioBased`), das in der Produktion unverzichtbar
ist, um nicht vom Trace-Volumen überwältigt zu werden.

> Mit OpenTelemetry zu instrumentieren bedeutet, den Code vom Monitoring-Tool zu entkoppeln. Wenn
> man von Jaeger zu Azure Monitor migriert, **ändert man keine einzige Zeile App-Code**: man
> tauscht den Exporter des Collectors aus.
