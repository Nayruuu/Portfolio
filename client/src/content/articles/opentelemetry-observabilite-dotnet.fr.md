Quand une requête traverse trois services et qu'elle est lente, les logs seuls ne disent pas
**où**. L'observabilité moderne repose sur trois signaux corrélés — traces, métriques, logs —
et **OpenTelemetry** en est le standard vendor-neutral : on instrumente une fois, on exporte
vers n'importe quel backend (Jaeger, Prometheus, Azure Monitor) sans réécrire le code.

## Trois signaux, une seule API

OpenTelemetry unifie les trois piliers de l'observabilité. Les **traces** suivent une requête
de bout en bout via une suite de spans corrélés par un `trace_id`. Les **métriques** agrègent
des compteurs et histogrammes (taux de requêtes, latence p95). Les **logs** apportent le
contexte textuel, désormais rattaché au `trace_id` courant. .NET expose nativement ces
concepts via `System.Diagnostics.Activity` (les spans) et `System.Diagnostics.Metrics`.

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

## Auto-instrumentation vs spans manuels

L'**auto-instrumentation** couvre gratuitement l'essentiel : `AddAspNetCoreInstrumentation`
crée un span par requête entrante, `AddHttpClientInstrumentation` propage le contexte sur les
appels sortants — la corrélation inter-services se fait toute seule via les en-têtes
`traceparent` du standard W3C. Pour la logique métier, on ajoute des **spans manuels** afin de
mesurer une opération précise et d'y attacher des attributs métier.

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

Les attributs (`SetTag`) transforment une trace en outil de debug : on filtre par
`order.total > 1000` ou on repère le span précis qui a explosé en latence.

## L'exporteur OTLP et le Collector

**OTLP** (OpenTelemetry Protocol) est le format de transport commun. Plutôt que d'exporter
directement vers un backend, on envoie tout au **Collector** : un processus intermédiaire qui
reçoit, transforme (batching, échantillonnage, filtrage des attributs sensibles) et redistribue
vers une ou plusieurs destinations. L'app ne connaît qu'**un** endpoint ; changer de backend
devient une modification de config côté Collector, pas un redéploiement.

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

L'app pointe vers le Collector via `OTEL_EXPORTER_OTLP_ENDPOINT`, une variable
d'environnement standard. La [documentation OpenTelemetry](https://opentelemetry.io/docs/languages/net/)
couvre l'échantillonnage (`ParentBased`, `TraceIdRatioBased`) indispensable en prod pour ne pas
crouler sous le volume de traces.

> Instrumenter avec OpenTelemetry, c'est découpler son code de son outil de monitoring. Le jour
> où l'on migre de Jaeger vers Azure Monitor, **on ne touche pas à une seule ligne d'app** : on
> change l'exporteur du Collector.
