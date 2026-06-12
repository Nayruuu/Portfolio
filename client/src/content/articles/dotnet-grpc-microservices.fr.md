Entre microservices, le JSON sur HTTP/1.1 paie cher son confort : sérialisation verbeuse,
pas de contrat fort, une connexion par appel. **gRPC** répond à ce contexte précis — du
binaire compact sur HTTP/2, un contrat partagé et du code généré des deux côtés. En .NET,
l'intégration est de première classe.

## Le contrat .proto, source unique de vérité

Tout part d'un fichier `.proto` : il décrit les messages et le service, indépendamment du
langage. C'est **le** contrat — ni le client ni le serveur ne l'écrivent à la main. On y
déclare un `service Pricing` exposant un appel `rpc GetQuote (QuoteRequest)` qui renvoie un
`QuoteReply`, chaque champ étant numéroté (`string sku = 1;`, `int32 quantity = 2;`) — ces
numéros sont la clé de la compatibilité ascendante : on n'en réutilise jamais un.

Côté .NET, on référence ce fichier dans le `.csproj` via `<Protobuf Include="pricing.proto" />`.
Le package `Grpc.Tools` génère alors, à la compilation, la classe de base serveur et le
client typé — aucun DTO à recopier :

```csharp
// Généré par Grpc.Tools à partir de pricing.proto — ne pas éditer
public partial class QuoteRequest
{
    public string Sku { get; set; }
    public int Quantity { get; set; }
}
```

## Serveur et client typés

Le serveur dérive de la classe générée `Pricing.PricingBase` et redéfinit la méthode. Pas de
routing à câbler, pas de désérialisation manuelle : on reçoit un message fortement typé.

```csharp
public sealed class PricingService(IPriceBook book) : Pricing.PricingBase
{
    public override async Task<QuoteReply> GetQuote(
        QuoteRequest request, ServerCallContext context)
    {
        var unitPrice = await book.LookupAsync(request.Sku, context.CancellationToken);

        return new QuoteReply { UnitPriceCents = unitPrice * request.Quantity };
    }
}
```

Côté appelant, on n'écrit pas non plus de `HttpClient`. On injecte le client généré via
`AddGrpcClient`, et on l'appelle comme une méthode locale :

```csharp
builder.Services.AddGrpcClient<Pricing.PricingClient>(options =>
    options.Address = new Uri("https://pricing:443"));
```

## Le streaming, l'argument décisif

Là où REST plafonne, gRPC excelle : HTTP/2 permet le **streaming** dans les deux sens.
Un `stream` côté serveur pousse des résultats au fil de l'eau ; un `stream` bidirectionnel
ouvre un canal full-duplex idéal pour la télémétrie ou le chat. On écrit dans un
`IServerStreamWriter<T>` et le client itère avec `await foreach` — sans polling, sans
WebSocket à bricoler.

## gRPC contre REST : choisir en connaissance de cause

gRPC n'est pas universel. Ses points forts — binaire compact, contrat fort, streaming,
latence faible — en font l'outil **interne** par excellence (service-à-service). Ses limites
sont réelles : un navigateur ne parle pas gRPC nativement (il faut gRPC-Web et un proxy), le
binaire n'est pas lisible à l'œil, et le débogage demande des outils dédiés. Pour une API
**publique** consommée par des tiers, REST/JSON reste souvent le bon choix. Le guide
Microsoft compare les deux dans la
[doc gRPC pour .NET](https://learn.microsoft.com/en-us/aspnet/core/grpc/).

> Le réflexe sain : **REST en façade publique, gRPC à l'intérieur**. Le contrat .proto
> devient alors la frontière formelle entre vos services — versionnée, partagée, vérifiée
> par le compilateur.
