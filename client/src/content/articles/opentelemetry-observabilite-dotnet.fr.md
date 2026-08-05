Quand une requête traverse trois services et qu'elle traîne, les logs seuls ne disent pas
**où**. Ils racontent chaque service en vase clos, sans le fil qui les relie. L'observabilité
s'appuie sur trois signaux corrélés (traces, métriques, logs), et **OpenTelemetry** en est le
standard vendor-neutral : on instrumente une fois, on exporte vers n'importe quel backend
(Jaeger, Prometheus, Azure Monitor) sans réécrire le code applicatif.

## Trois signaux, une même plomberie

En .NET, OpenTelemetry ne réinvente rien : il se branche sur des primitives déjà présentes
dans le BCL. Une **trace** suit une requête de bout en bout via une suite de spans reliés par
un `trace_id`, et côté .NET un span est une `System.Diagnostics.Activity`. Les **métriques**
agrègent compteurs et histogrammes (taux de requêtes, latence p95) au travers d'un
`System.Diagnostics.Metrics.Meter`. Les **logs** passent par `ILogger`, désormais rattachés au
`trace_id` du contexte courant.

Le SDK est donc surtout un *listener* : il écoute les `Activity` et les `Meter` que votre code
et les bibliothèques produisent déjà, puis les exporte. On l'installe via le paquet
`OpenTelemetry.Extensions.Hosting` et on le câble au démarrage.

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

`ConfigureResource` fixe le `service.name` qui identifie l'app dans le backend. Le reste
déclare ce qu'on écoute et où on l'envoie.

## Auto-instrumentation et spans manuels

L'auto-instrumentation couvre l'essentiel sans écrire de code. `AddAspNetCoreInstrumentation`
crée un span par requête entrante ; `AddHttpClientInstrumentation` en crée un par appel sortant
et y injecte le contexte. Ces instrumentations suivent les *semantic conventions*
d'OpenTelemetry : les attributs portent des noms normalisés (`http.request.method`, `url.path`,
`http.response.status_code`), ce qui rend une trace lisible quel que soit le backend.

Pour la logique métier, on ajoute des spans manuels. Un piège classique attend ici : une
`ActivitySource` maison ne produit rien tant que son nom n'est pas déclaré via `AddSource`.
Sans cette ligne (présente dans la config plus haut), `StartActivity` renvoie `null` et le span
disparaît en silence.

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

Le `?.` n'est pas de la prudence décorative : quand aucun listener n'échantillonne le span,
`StartActivity` renvoie `null`, et le code doit continuer sans broncher. Les attributs
(`SetTag`) transforment la trace en outil de debug : on filtre sur `order.total > 1000`, on
repère le span exact qui a explosé en latence, et `SetStatus(Error)` marque la trace comme
fautive pour la faire remonter en tête des recherches.

## Compter avec les métriques

Une trace échantillonnée perd des requêtes ; une métrique, non. Pour un taux ou un p95 fiable,
on compte tout via un `Meter`. En ASP.NET Core, on l'obtient par injection avec `IMeterFactory`
plutôt qu'en champ statique, ce qui laisse le SDK gérer son cycle de vie.

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

Le nom `SuperDev.Orders` doit correspondre à l'`AddMeter` de la config, même règle que pour les
traces. Attention au choix des dimensions : `order.channel` prend quelques valeurs, mais un
`order.id` en tag ferait exploser la cardinalité, car chaque valeur distincte crée une série
temporelle. Les identifiants uniques ont leur place sur un span, jamais sur un compteur.

Côté logs, le pont OpenTelemetry attache automatiquement le `trace_id` et le `span_id` du
contexte à chaque entrée `ILogger`. Depuis un span lent, on saute alors aux logs exacts de
cette requête, sans grep sur un horodatage approximatif.

## Propager le contexte entre services

La corrélation inter-services tient à un standard, le **W3C Trace Context**.
`AddHttpClientInstrumentation` sérialise le contexte courant dans l'en-tête `traceparent`
(de forme `00-{trace_id}-{span_id}-{flags}`), et l'instrumentation ASP.NET Core du service
appelé le relit pour rattacher son span au bon parent. Rien à câbler tant qu'on reste en HTTP.

Hors HTTP, le lien se perd. Un message posé sur une file (Service Bus, Kafka) ne transporte pas
d'en-tête HTTP : il faut injecter le `traceparent` dans les propriétés du message à l'envoi,
puis le ré-extraire à la réception, via `Propagators.DefaultTextMapPropagator`. Le **baggage**
emprunte le même canal pour propager des paires clé/valeur métier (un `tenant.id`, par exemple)
tout au long de la chaîne d'appels.

## OTLP, le Collector et l'échantillonnage

**OTLP** (OpenTelemetry Protocol) est le format de transport commun, en gRPC sur le port 4317
ou en HTTP sur le 4318. Plutôt que d'exporter directement vers un backend, on envoie tout au
**Collector** : un processus intermédiaire qui reçoit, transforme (batching, filtrage des
attributs sensibles, échantillonnage) et redistribue vers une ou plusieurs destinations. L'app
ne connaît qu'un endpoint, réglé par la variable standard `OTEL_EXPORTER_OTLP_ENDPOINT` ;
changer de backend devient une modification de config côté Collector, pas un redéploiement.

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

Reste l'échantillonnage, indispensable en prod pour ne pas exporter chaque trace. Le SDK gère
un échantillonnage *head-based* : `SetSampler(new ParentBasedSampler(new
TraceIdRatioBasedSampler(0.1)))` garde 10 % des traces tout en respectant la décision déjà
prise en amont, si bien qu'un parent échantillonné conserve ses enfants et qu'une trace reste
cohérente d'un service à l'autre. Pour ne garder que les traces intéressantes (erreurs, latence
haute), on déplace la décision en *tail-based* dans le Collector via le processor
`tail_sampling`, une fois la trace complète reçue. La
[documentation OpenTelemetry pour .NET](https://opentelemetry.io/docs/languages/net/) détaille
les deux stratégies.

> Instrumenter avec OpenTelemetry découple le code de l'outil de monitoring. Le SDK .NET se
> contente d'écouter les `Activity` et les `Meter` que le runtime produit déjà ; migrer de
> Jaeger vers Azure Monitor se règle côté Collector, sans toucher au code applicatif.
