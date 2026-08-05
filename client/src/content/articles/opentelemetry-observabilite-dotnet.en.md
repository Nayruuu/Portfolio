Quand une requête traverse trois services et qu'elle traîne → When a request crosses three services and drags on, logs alone don't say **where**. They tell each service's story in isolation, without the thread that connects them. Observability rests on three correlated signals (traces, metrics, logs), and **OpenTelemetry** is the vendor-neutral standard for it: instrument once, export to any backend (Jaeger, Prometheus, Azure Monitor) without rewriting application code.

## Three signals, one plumbing

In .NET, OpenTelemetry doesn't reinvent anything: it hooks into primitives already present in the BCL. A **trace** follows a request end to end via a chain of spans linked by a `trace_id`, and on the .NET side a span is a `System.Diagnostics.Activity`. **Metrics** aggregate counters and histograms (request rate, p95 latency) through a `System.Diagnostics.Metrics.Meter`. **Logs** go through `ILogger`, now attached to the `trace_id` of the current context.

The SDK is therefore mostly a *listener*: it listens to the `Activity` and `Meter` instances that your code and libraries already produce, then exports them. You install it via the `OpenTelemetry.Extensions.Hosting` package and wire it up at startup.

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

`ConfigureResource` sets the `service.name` that identifies the app in the backend. The rest declares what gets listened to and where it's sent.

## Auto-instrumentation and manual spans

Auto-instrumentation covers the essentials without writing code. `AddAspNetCoreInstrumentation`
creates one span per incoming request; `AddHttpClientInstrumentation` creates one per outgoing
call and injects the context into it. These instrumentations follow OpenTelemetry's *semantic
conventions*: attributes carry standardized names (`http.request.method`, `url.path`,
`http.response.status_code`), which makes a trace readable regardless of the backend.

For business logic, you add manual spans. A classic trap lurks here: a homemade
`ActivitySource` produces nothing until its name is declared via `AddSource`.
Without that line (present in the config above), `StartActivity` returns `null` and the span
silently disappears.

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

The `?.` isn't decorative caution: when no listener samples the span,
`StartActivity` returns `null`, and the code must carry on without flinching. Attributes
(`SetTag`) turn the trace into a debugging tool: you filter on `order.total > 1000`, pinpoint
the exact span that blew up in latency, and `SetStatus(Error)` marks the trace as
faulty so it surfaces at the top of searches.

## Counting with metrics

A sampled trace loses requests; a metric doesn't. For a reliable rate or p95, you count
everything via a `Meter`. In ASP.NET Core, you obtain it through injection with `IMeterFactory`
rather than as a static field, which lets the SDK manage its lifecycle.

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

The name `SuperDev.Orders` must match the config's `AddMeter`, the same rule as for
traces. Watch the choice of dimensions: `order.channel` takes a handful of values, but an
`order.id` tag would blow up cardinality, since each distinct value creates a time
series. Unique identifiers belong on a span, never on a counter.

On the logging side, the OpenTelemetry bridge automatically attaches the `trace_id` and `span_id` of the
current context to every `ILogger` entry. From a slow span, you can then jump straight to the exact logs of
that request, without grepping on an approximate timestamp.

## Propagating context across services

Cross-service correlation rests on a standard, **W3C Trace Context**.
`AddHttpClientInstrumentation` serializes the current context into the `traceparent` header
(shaped like `00-{trace_id}-{span_id}-{flags}`), and the ASP.NET Core instrumentation of the
called service reads it back to attach its span to the right parent. Nothing to wire up as long as you stay in HTTP.

Outside HTTP, the link is lost. A message placed on a queue (Service Bus, Kafka) doesn't carry
an HTTP header: you have to inject the `traceparent` into the message properties on send,
then re-extract it on receive, via `Propagators.DefaultTextMapPropagator`. **Baggage**
takes the same channel to propagate business key/value pairs (a `tenant.id`, for example)
throughout the call chain.

## OTLP, the Collector, and sampling

**OTLP** (OpenTelemetry Protocol) is the common transport format, over gRPC on port 4317
or over HTTP on 4318. Rather than exporting directly to a backend, you send everything to the
**Collector**: an intermediate process that receives, transforms (batching, filtering
sensitive attributes, sampling) and redistributes to one or more destinations. The app
only knows one endpoint, set via the standard `OTEL_EXPORTER_OTLP_ENDPOINT` variable;
switching backends becomes a config change on the Collector side, not a redeploy.

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

That leaves sampling, essential in prod so you don't export every single trace. The SDK handles
*head-based* sampling: `SetSampler(new ParentBasedSampler(new
TraceIdRatioBasedSampler(0.1)))` keeps 10% of traces while respecting the decision already
made upstream, so that a sampled parent keeps its children and a trace stays
coherent from one service to another. To keep only the interesting traces (errors, high
latency), you move the decision to *tail-based* in the Collector via the
`tail_sampling` processor, once the full trace has been received. The
[OpenTelemetry documentation for .NET](https://opentelemetry.io/docs/languages/net/) details
both strategies.

> Instrumenting with OpenTelemetry decouples the code from the monitoring tool. The .NET SDK
> just listens to the `Activity` and `Meter` instances the runtime already produces; migrating from
> Jaeger to Azure Monitor is settled on the Collector side, without touching the application code.
