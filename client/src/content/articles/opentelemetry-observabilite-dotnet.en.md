When a request crosses three services and turns slow, logs alone don't tell you **where**.
Modern observability rests on three correlated signals — traces, metrics, logs — and
**OpenTelemetry** is its vendor-neutral standard: you instrument once and export to any backend
(Jaeger, Prometheus, Azure Monitor) without rewriting code.

## Three signals, one API

OpenTelemetry unifies the three pillars of observability. **Traces** follow a request end to
end through a series of spans correlated by a `trace_id`. **Metrics** aggregate counters and
histograms (request rate, p95 latency). **Logs** add the textual context, now attached to the
current `trace_id`. .NET exposes these concepts natively through `System.Diagnostics.Activity`
(the spans) and `System.Diagnostics.Metrics`.

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

**Auto-instrumentation** covers the essentials for free: `AddAspNetCoreInstrumentation` creates
a span per incoming request, and `AddHttpClientInstrumentation` propagates the context on
outbound calls — cross-service correlation happens on its own through the W3C standard
`traceparent` headers. For business logic, you add **manual spans** to measure a precise
operation and attach domain attributes to it.

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

Attributes (`SetTag`) turn a trace into a debugging tool: you filter by `order.total > 1000` or
pinpoint the exact span whose latency blew up.

## The OTLP exporter and the Collector

**OTLP** (OpenTelemetry Protocol) is the common transport format. Instead of exporting straight
to a backend, you send everything to the **Collector**: an intermediate process that receives,
transforms (batching, sampling, scrubbing sensitive attributes) and redistributes to one or
more destinations. The app knows only **one** endpoint; switching backends becomes a config
change on the Collector side, not a redeploy.

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

The app points at the Collector via `OTEL_EXPORTER_OTLP_ENDPOINT`, a standard environment
variable. The [OpenTelemetry documentation](https://opentelemetry.io/docs/languages/net/)
covers the sampling (`ParentBased`, `TraceIdRatioBased`) that is essential in production so you
don't drown under trace volume.

> Instrumenting with OpenTelemetry decouples your code from your monitoring tool. The day you
> migrate from Jaeger to Azure Monitor, **you don't touch a single line of the app**: you just
> swap the Collector's exporter.
