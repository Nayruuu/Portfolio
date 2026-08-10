Entre deux microservices, échanger du JSON sur HTTP/1.1 coûte plus qu'il n'y paraît :
sérialisation verbeuse, aucun contrat que le compilateur puisse vérifier, une connexion
rouverte à chaque requête. **gRPC** vise ce cas précis avec du Protobuf binaire sur HTTP/2, un
contrat partagé et du code généré des deux côtés. En .NET, la pile `Grpc.AspNetCore` en fait une
intégration de première classe, sans dépendance tierce à greffer.

## Le contrat .proto, source unique de vérité

Tout part d'un fichier `.proto` qui décrit les messages et le service indépendamment du langage.
C'est **le** contrat, et ni le client ni le serveur n'en recopient les types à la main. La
[syntaxe proto3](https://protobuf.dev/programming-guides/proto3/) tient en peu de mots : un
`service`, des `rpc`, des `message` dont chaque champ porte un numéro.

```proto
syntax = "proto3";

option csharp_namespace = "Catalog.Pricing";

service Pricing {
  // Unary: one request, one reply
  rpc GetQuote (QuoteRequest) returns (QuoteReply);

  // Server streaming: one request, a stream of replies
  rpc WatchPrices (WatchRequest) returns (stream PriceTick);

  // Client streaming: a stream of requests, one reply
  rpc BulkImport (stream PriceUpdate) returns (ImportSummary);

  // Bidirectional: two independent streams over one call
  rpc Negotiate (stream Offer) returns (stream Counter);
}

message QuoteRequest {
  string sku = 1;
  int32 quantity = 2;
}

message QuoteReply {
  int64 unit_price_cents = 1;
}
```

Ces numéros sont l'identité des champs sur le fil : on n'en réutilise jamais un, même après
avoir supprimé le champ qui le portait. C'est ce qui rend un ancien binaire lisible par un schéma
plus récent, la compatibilité ascendante par construction. Le mot-clé `stream`, placé sur
l'entrée, la sortie ou les deux, décrit les quatre formes d'appel.

Dans le `.csproj`, une ligne suffit : `<Protobuf Include="Protos/pricing.proto" GrpcServices="Both" />`.
À la compilation, `Grpc.Tools` lance `protoc` et génère les classes de messages, la classe de base
serveur `Pricing.PricingBase` et le client `Pricing.PricingClient`. Le `snake_case` du proto devient
du `PascalCase` en C#, `unit_price_cents` se lit `UnitPriceCents`. Aucun DTO à écrire, aucun à tenir
à jour en double.

## Serveur et client typés

Le serveur dérive de la classe générée et redéfinit la méthode. Pas de routing à câbler, pas de
désérialisation manuelle : un message fortement typé arrive, un message typé repart.

```csharp
// Server: derive from the generated base, override the method
public sealed class PricingService(IPriceBook book) : Pricing.PricingBase
{
    public override async Task<QuoteReply> GetQuote(
        QuoteRequest request, ServerCallContext context)
    {
        var unit = await book.LookupAsync(request.Sku, context.CancellationToken);

        return new QuoteReply { UnitPriceCents = unit * request.Quantity };
    }
}

// Client: injected, called like a local method, with a 2s deadline
var reply = await client.GetQuoteAsync(
    new QuoteRequest { Sku = "A-17", Quantity = 4 },
    deadline: DateTime.UtcNow.AddSeconds(2),
    cancellationToken: ct);
```

Le câblage serveur tient en deux lignes dans `Program.cs` : `builder.Services.AddGrpc();` puis
`app.MapGrpcService<PricingService>();`. Côté appelant, `Grpc.Net.Client` fournit le canal, et
l'enregistrement passe par l'injection de dépendances,
`AddGrpcClient<Pricing.PricingClient>(o => o.Address = new Uri("https://pricing:443"))`. Le client
injecté s'appelle comme une méthode locale ; en dessous, une seule connexion HTTP/2 multiplexe les
appels concurrents plutôt que d'en rouvrir une à chaque requête.

## Les quatre formes d'appel

L'appel **unaire** (une requête, une réponse) couvre l'essentiel du trafic et ressemble de près à
un appel REST. Les trois autres formes exploitent la capacité d'HTTP/2 à garder un flux ouvert, ce
que REST ne fait pas nativement.

Le **server streaming** pousse une suite de messages sur une seule requête : le serveur écrit dans
un `IServerStreamWriter<T>`, le client itère avec `await foreach`.

```csharp
// Server pushes ticks until the caller stops listening
public override async Task WatchPrices(
    WatchRequest request,
    IServerStreamWriter<PriceTick> responses,
    ServerCallContext context)
{
    await foreach (var tick in book.Ticks(request.Sku, context.CancellationToken))
    {
        await responses.WriteAsync(tick);
    }
}

// Client consumes the stream with await foreach
using var call = client.WatchPrices(new WatchRequest { Sku = "A-17" });
await foreach (var tick in call.ResponseStream.ReadAllAsync(ct))
{
    Render(tick);
}
```

Le **client streaming** inverse le sens : le client envoie un flux, le serveur le lit via un
`IAsyncStreamReader<T>` et renvoie un seul résumé, pratique pour un import en masse. Le
**bidirectionnel** ouvre deux flux indépendants sur le même appel, pour de la télémétrie ou une
boucle de négociation, sans polling ni WebSocket à bricoler.

## Deadlines, annulation et statuts

Un appel réseau sans borne de temps est un incident qui attend son heure. gRPC porte la notion de
**deadline** dans le protocole : un instant absolu, pas une durée, transmis avec l'appel. Sur le
client, on le passe à l'appel, `deadline: DateTime.UtcNow.AddSeconds(2)`.

Quand il expire, le `context.CancellationToken` du serveur se déclenche et le client reçoit un
`RpcException` de statut `DeadlineExceeded`. Rien à voir avec un timeout purement client, qui
abandonne l'attente mais laisse le serveur travailler dans le vide. Passer ce jeton aux appels en
aval, base de données ou service suivant, fait remonter l'abandon dans toute la chaîne.

gRPC définit aussi un jeu fermé de **codes de statut** : `NotFound`, `InvalidArgument`,
`PermissionDenied`, `Unavailable`, `Unauthenticated`. Le serveur signale un échec métier en levant
`throw new RpcException(new Status(StatusCode.NotFound, "unknown sku"))`, et le client branche
dessus avec `catch (RpcException ex) when (ex.StatusCode == StatusCode.Unavailable)`. Là où un `500`
REST est un fourre-tout dont le sens se devine, le statut gRPC est typé et se teste.

## Intercepteurs pour le transverse

Journalisation, métriques, authentification, réessais : ces préoccupations reviennent à chaque
appel. Un **intercepteur** les factorise en enveloppant les handlers, l'équivalent d'un middleware
pour le pipeline gRPC. On dérive de `Interceptor` et on redéfinit le maillon voulu, ici l'appel
unaire côté serveur.

```csharp
public sealed class LoggingInterceptor(ILogger<LoggingInterceptor> log) : Interceptor
{
    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request,
        ServerCallContext context,
        UnaryServerMethod<TRequest, TResponse> continuation)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            return await continuation(request, context);
        }
        catch (RpcException ex)
        {
            log.LogWarning("{Method} failed with {Status}", context.Method, ex.StatusCode);
            throw;
        }
        finally
        {
            log.LogInformation("{Method} took {Elapsed}ms", context.Method, sw.ElapsedMilliseconds);
        }
    }
}
```

On l'enregistre une fois, `AddGrpc(o => o.Interceptors.Add<LoggingInterceptor>())`, et il couvre
tous les services. Le même mécanisme existe côté client via `.AddInterceptor<T>()`, pour attacher
un jeton d'authentification ou une politique de réessai sans polluer chaque appel.

## gRPC ou REST : choisir en connaissance de cause

gRPC n'est pas universel. Un contrat que le compilateur vérifie et un binaire compact sur HTTP/2 le
destinent d'abord au trafic **interne**, de service à service, là où les deux extrémités du canal
sont à vous. Le streaming full-duplex renforce ce positionnement.

Ses limites sont concrètes. Un navigateur ne parle pas gRPC nativement : il n'accède pas aux
trailers HTTP/2 dont le protocole dépend, et il faut passer par
[gRPC-Web](https://learn.microsoft.com/en-us/aspnet/core/grpc/grpcweb) avec un proxy. Le binaire ne
se lit pas à l'œil dans les logs, et le débogage réclame des outils dédiés.

Pour une API **publique** exposée à des tiers, REST/JSON reste souvent le meilleur choix : lisible
dans un navigateur et cacheable au niveau HTTP. Le
[guide gRPC pour .NET](https://learn.microsoft.com/en-us/aspnet/core/grpc/) détaille ce partage des
rôles.

> Le partage sain : REST en façade publique, gRPC à l'intérieur. Le fichier .proto devient alors la
> frontière formelle entre vos services, une frontière versionnée et partagée, que le compilateur
> vérifie aux deux extrémités.
