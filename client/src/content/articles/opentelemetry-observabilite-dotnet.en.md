When a request crosses three services and it's slow, logs alone don't say
**where**. Modern observability relies on three correlated signals (traces, metrics, logs),
and **OpenTelemetry** is the vendor-neutral standard for it: you instrument once, and export
to any backend (Jaeger, Prometheus, Azure Monitor) without rewriting the code.

## Three signals, one API

OpenTelemetry unifies the three pillars of observability. **Traces** follow a request
end to end via a series of spans correlated by a `trace_id`. **Metrics** aggregate
counters and histograms (request rate, p95 latency). **Logs** provide textual
context, now tied to the current `trace_id`.

.NET natively exposes these concepts via `System.Diagnostics.Activity` (spans) and
`System.Diagnostics.Metrics`.

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

## Auto-instrumentation vs manual spans

**Auto-instrumentation** covers the essentials for free: `AddAspNetCoreInstrumentation`
creates a span per incoming request, `AddHttpClientInstrumentation` propagates context on
outgoing calls. Cross-service correlation happens on its own via the W3C standard's
`traceparent` headers.

For business logic, you add **manual spans** to measure a specific operation
and attach business attributes to it.

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

The attributes (`SetTag`) turn a trace into a debugging tool: you filter by
`order.total > 1000` or pinpoint the exact span that spiked in latency.

## The OTLP exporter and the Collector

**OTLP** (OpenTelemetry Protocol) is the common transport format. Rather than exporting
directly to a backend, everything is sent to the **Collector**: an intermediary process that
receives, transforms (batching, sampling, filtering sensitive attributes), and redistributes
to one or more destinations.

The app only knows about **one** endpoint; switching backends becomes a config change
on the Collector side, not a redeployment.

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

The app points to the Collector via `OTEL_EXPORTER_OTLP_ENDPOINT`, a standard
environment variable. The [OpenTelemetry documentation](https://opentelemetry.io/docs/languages/net/)
covers sampling (`ParentBased`, `TraceIdRatioBased`), essential in production so you don't
buckle under the volume of traces.

> Instrumenting with OpenTelemetry decouples your code from your monitoring tool. The day
> you migrate from Jaeger to Azure Monitor, **you don't touch a single line of app code**: you
> change the Collector's exporter.
