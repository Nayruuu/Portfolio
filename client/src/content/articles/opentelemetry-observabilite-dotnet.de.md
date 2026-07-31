Wenn eine Anfrage drei Services durchläuft und dabei langsam ist, verraten die Logs allein nicht,
**wo**. Moderne Observability beruht auf drei korrelierten Signalen (Traces, Metriken, Logs),
und **OpenTelemetry** ist der herstellerneutrale Standard dafür: Man instrumentiert einmal und
exportiert zu einem beliebigen Backend (Jaeger, Prometheus, Azure Monitor), ohne den Code
umzuschreiben.

## Drei Signale, eine einzige API

OpenTelemetry vereint die drei Säulen der Observability. Die **Traces** verfolgen eine Anfrage
von Ende zu Ende über eine Reihe von Spans, die durch eine `trace_id` korreliert sind. Die
**Metriken** aggregieren Zähler und Histogramme (Anfragerate, p95-Latenz). Die **Logs** liefern
den textuellen Kontext, der nun mit der aktuellen `trace_id` verknüpft ist.

.NET stellt diese Konzepte nativ über `System.Diagnostics.Activity` (die Spans) und
`System.Diagnostics.Metrics` bereit.

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

## Auto-Instrumentierung vs. manuelle Spans

Die **Auto-Instrumentierung** deckt das Wesentliche kostenlos ab: `AddAspNetCoreInstrumentation`
erzeugt einen Span pro eingehender Anfrage, `AddHttpClientInstrumentation` propagiert den Kontext
bei ausgehenden Aufrufen. Die Korrelation zwischen Services erfolgt von selbst über die
`traceparent`-Header des W3C-Standards.

Für die Geschäftslogik fügt man **manuelle Spans** hinzu, um eine bestimmte Operation zu messen
und ihr fachliche Attribute anzuhängen.

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

Die Attribute (`SetTag`) verwandeln eine Trace in ein Debugging-Werkzeug: Man filtert nach
`order.total > 1000` oder findet genau den Span, dessen Latenz explodiert ist.

## Der OTLP-Exporter und der Collector

**OTLP** (OpenTelemetry Protocol) ist das gemeinsame Transportformat. Statt direkt zu einem
Backend zu exportieren, sendet man alles an den **Collector**: einen Zwischenprozess, der
empfängt, transformiert (Batching, Sampling, Filtern sensibler Attribute) und an ein oder
mehrere Ziele weiterverteilt.

Die App kennt nur **einen** Endpoint; ein Backend-Wechsel wird zu einer Konfigurationsänderung
auf Collector-Seite, nicht zu einem Redeployment.

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

Die App zeigt über `OTEL_EXPORTER_OTLP_ENDPOINT` auf den Collector, eine standardmäßige
Umgebungsvariable. Die [OpenTelemetry-Dokumentation](https://opentelemetry.io/docs/languages/net/)
behandelt das Sampling (`ParentBased`, `TraceIdRatioBased`), das in der Produktion unerlässlich
ist, um nicht unter dem Trace-Volumen zusammenzubrechen.

> Mit OpenTelemetry zu instrumentieren bedeutet, den eigenen Code vom Monitoring-Werkzeug zu
> entkoppeln. Am Tag, an dem man von Jaeger zu Azure Monitor migriert, **rührt man keine einzige
> Zeile der App an**: Man ändert den Exporter des Collectors.
