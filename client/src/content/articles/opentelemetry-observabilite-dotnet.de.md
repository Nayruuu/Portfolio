Prometheus, Azure Monitor) ohne Änderungen am Anwendungscode.

## Drei Signale, eine gemeinsame Verkabelung

In .NET erfindet OpenTelemetry nichts neu: Es dockt an Primitiven an, die bereits in der BCL
vorhanden sind. Eine **Trace** verfolgt eine Anfrage von Anfang bis Ende über eine Kette von
Spans, die durch eine `trace_id` verbunden sind, und auf .NET-Seite ist ein Span eine
`System.Diagnostics.Activity`. Die **Metriken** aggregieren Zähler und Histogramme
(Anfragerate, p95-Latenz) über einen `System.Diagnostics.Metrics.Meter`. Die **Logs** laufen
über `ILogger`, die inzwischen an die `trace_id` des aktuellen Kontexts gekoppelt sind.

Das SDK ist also vor allem ein *Listener*: Es lauscht auf die `Activity`- und `Meter`-Objekte,
die Ihr Code und die Bibliotheken bereits erzeugen, und exportiert sie anschließend. Man
installiert es über das Paket `OpenTelemetry.Extensions.Hosting` und verdrahtet es beim Start.

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

`ConfigureResource` legt den `service.name` fest, der die App im Backend identifiziert. Der
Rest deklariert, worauf man lauscht und wohin man es sendet.

## Auto-Instrumentierung und manuelle Spans

Die Auto-Instrumentierung deckt das Wesentliche ab, ohne dass Code geschrieben werden muss.
`AddAspNetCoreInstrumentation` erzeugt einen Span pro eingehender Anfrage; `AddHttpClientInstrumentation`
erzeugt einen pro ausgehendem Aufruf und injiziert dabei den Kontext. Diese Instrumentierungen
folgen den *Semantic Conventions* von OpenTelemetry: Die Attribute tragen standardisierte Namen
(`http.request.method`, `url.path`, `http.response.status_code`), was eine Trace unabhängig
vom Backend lesbar macht.

Für die Geschäftslogik fügt man manuelle Spans hinzu. Hier lauert eine klassische Falle: Eine
selbstgebaute `ActivitySource` erzeugt nichts, solange ihr Name nicht über `AddSource`
deklariert ist. Ohne diese Zeile (in der obigen Konfiguration vorhanden) gibt `StartActivity`
`null` zurück, und der Span verschwindet stillschweigend.

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

Das `?.` ist keine dekorative Vorsicht: Wenn kein Listener den Span sampelt, gibt
`StartActivity` `null` zurück, und der Code muss anstandslos weiterlaufen. Die Attribute
(`SetTag`) verwandeln die Trace in ein Debugging-Werkzeug: Man filtert nach `order.total > 1000`,
findet den genauen Span, der in die Latenz explodiert ist, und `SetStatus(Error)` markiert die
Trace als fehlerhaft, damit sie bei Suchen ganz oben auftaucht.

## Zählen mit Metriken

Eine gesampelte Trace verliert Anfragen; eine Metrik nicht. Für eine zuverlässige Rate oder ein
zuverlässiges p95 zählt man alles über einen `Meter`. In ASP.NET Core erhält man ihn per
Injection mit `IMeterFactory` statt als statisches Feld, wodurch das SDK dessen Lebenszyklus
verwaltet.

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

Der Name `SuperDev.Orders` muss mit dem `AddMeter` der Konfiguration übereinstimmen, dieselbe
Regel wie bei den Traces. Vorsicht bei der Wahl der Dimensionen: `order.channel` nimmt nur
wenige Werte an, aber ein `order.id` als Tag würde die Kardinalität explodieren lassen, da
jeder unterschiedliche Wert eine eigene Zeitreihe erzeugt. Eindeutige Identifikatoren gehören
auf einen Span, niemals auf einen Zähler.

Auf der Log-Seite hängt die OpenTelemetry-Brücke automatisch die `trace_id` und die `span_id`
des Kontexts an jeden `ILogger`-Eintrag an. Ausgehend von einem langsamen Span springt man so
direkt zu den exakten Logs dieser Anfrage, ohne ein Grep über einen ungefähren Zeitstempel.

## Kontext zwischen Diensten weitergeben

Die dienstübergreifende Korrelation beruht auf einem Standard, dem **W3C Trace Context**.
`AddHttpClientInstrumentation` serialisiert den aktuellen Kontext im Header `traceparent`
(in der Form `00-{trace_id}-{span_id}-{flags}`), und die ASP.NET-Core-Instrumentierung des
aufgerufenen Dienstes liest ihn wieder ein, um ihren Span an das richtige Elternteil zu hängen.
Solange man bei HTTP bleibt, ist nichts zu verdrahten.

Außerhalb von HTTP geht die Verbindung verloren. Eine Nachricht, die auf einer Queue landet
(Service Bus, Kafka), transportiert keinen HTTP-Header: Man muss den `traceparent` beim Senden
in die Eigenschaften der Nachricht injizieren und ihn beim Empfang über
`Propagators.DefaultTextMapPropagator` wieder extrahieren. Das **Baggage** nutzt denselben Kanal,
um geschäftliche Schlüssel-Wert-Paare (zum Beispiel eine `tenant.id`) über die gesamte
Aufrufkette hinweg zu propagieren.

## OTLP, der Collector und das Sampling

**OTLP** (OpenTelemetry Protocol) ist das gemeinsame Transportformat, per gRPC auf Port 4317
oder per HTTP auf Port 4318. Statt direkt zu einem Backend zu exportieren, schickt man alles an
den **Collector**: einen zwischengeschalteten Prozess, der empfängt, transformiert (Batching,
Filtern sensibler Attribute, Sampling) und an ein oder mehrere Ziele weiterverteilt. Die App
kennt nur einen Endpunkt, festgelegt über die Standardvariable `OTEL_EXPORTER_OTLP_ENDPOINT`;
ein Backend-Wechsel wird zu einer Konfigurationsänderung auf Collector-Seite, kein erneutes
Deployment.

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

Bleibt das Sampling, unverzichtbar in Produktion, um nicht jede Trace zu exportieren. Das SDK
verwaltet ein *head-based* Sampling: `SetSampler(new ParentBasedSampler(new
TraceIdRatioBasedSampler(0.1)))` behält 10 % der Traces, während die bereits vorgelagert
getroffene Entscheidung respektiert wird, sodass ein gesampeltes Elternteil seine Kinder behält
und eine Trace von einem Dienst zum anderen kohärent bleibt. Um nur die interessanten Traces
zu behalten (Fehler, hohe Latenz), verlagert man die Entscheidung in ein *tail-based* Sampling
im Collector über den `tail_sampling`-Processor, sobald die Trace vollständig empfangen wurde.
Die [OpenTelemetry-Dokumentation für .NET](https://opentelemetry.io/docs/languages/net/)
beschreibt beide Strategien im Detail.

> Die Instrumentierung mit OpenTelemetry entkoppelt den Code vom Monitoring-Werkzeug. Das
> .NET-SDK begnügt sich damit, auf die `Activity`- und `Meter`-Objekte zu lauschen, die die
> Laufzeit bereits erzeugt; ein Wechsel von Jaeger zu Azure Monitor wird auf Collector-Seite
> geregelt, ohne den Anwendungscode anzufassen.
