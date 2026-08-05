Entre deux Microservices JSON über HTTP/1.1 auszutauschen, kostet mehr, als es scheint:
verbose Serialisierung, kein Vertrag, den der Compiler prüfen könnte, eine bei jeder Anfrage neu
geöffnete Verbindung. **gRPC** zielt genau auf diesen Fall mit binärem Protobuf über HTTP/2, einem
gemeinsamen Vertrag und generiertem Code auf beiden Seiten. In .NET macht der Stack `Grpc.AspNetCore`
daraus eine erstklassige Integration, ohne zusätzliche Drittanbieter-Abhängigkeit.

## Der .proto-Vertrag, einzige Quelle der Wahrheit

Alles beginnt mit einer `.proto`-Datei, die Nachrichten und Service sprachunabhängig beschreibt.
Das ist **der** Vertrag, und weder Client noch Server schreiben dessen Typen von Hand ab. Die
[proto3-Syntax](https://protobuf.dev/programming-guides/proto3/) kommt mit wenigen Worten aus: ein
`service`, `rpc`-Methoden, `message`-Typen, deren Felder jeweils eine Nummer tragen.

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

Diese Nummern sind die Identität der Felder auf der Leitung: Man verwendet sie nie wieder, selbst
nachdem das Feld, das sie trug, gelöscht wurde. Das macht ein altes Binärformat für ein neueres
Schema lesbar, Abwärtskompatibilität qua Konstruktion. Das Schlüsselwort `stream`, das auf Eingabe,
Ausgabe oder beiden platziert wird, beschreibt die vier Aufrufformen.

In der `.csproj` genügt eine Zeile: `<Protobuf Include="Protos/pricing.proto" GrpcServices="Both" />`.
Beim Kompilieren startet `Grpc.Tools` `protoc` und generiert die Nachrichtenklassen, die
Server-Basisklasse `Pricing.PricingBase` und den Client `Pricing.PricingClient`. Das `snake_case`
des Proto wird zu `PascalCase` in C#, aus `unit_price_cents` wird `UnitPriceCents`. Kein DTO zu
schreiben, keines doppelt zu pflegen.

## Typisierte Server und Clients

Der Server leitet sich von der generierten Klasse ab und überschreibt die Methode. Kein Routing zu
verdrahten, keine manuelle Deserialisierung: Eine stark typisierte Nachricht kommt an, eine typisierte
Nachricht geht zurück.

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

Die serverseitige Verdrahtung passt in zwei Zeilen in `Program.cs`: `builder.Services.AddGrpc();`
gefolgt von `app.MapGrpcService<PricingService>();`. Auf Aufruferseite stellt `Grpc.Net.Client` den
Kanal bereit, und die Registrierung läuft über Dependency Injection,
`AddGrpcClient<Pricing.PricingClient>(o => o.Address = new Uri("https://pricing:443"))`. Der
injizierte Client wird wie eine lokale Methode aufgerufen; darunter multiplext eine einzige
HTTP/2-Verbindung die parallelen Aufrufe, statt bei jeder Anfrage eine neue zu öffnen.

## Die vier Aufrufformen

Der **unäre** Aufruf (eine Anfrage, eine Antwort) deckt den Großteil des Traffics ab und ähnelt
stark einem REST-Aufruf. Die drei anderen Formen nutzen die Fähigkeit von HTTP/2, einen Stream
offen zu halten, was REST nicht nativ kann.

Das **Server-Streaming** schiebt eine Folge von Nachrichten über eine einzige Anfrage: Der Server
schreibt in einen `IServerStreamWriter<T>`, der Client iteriert mit `await foreach`.

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

Das **Client-Streaming** kehrt die Richtung um: Der Client sendet einen Stream, der Server liest ihn
über einen `IAsyncStreamReader<T>` und liefert eine einzige Zusammenfassung zurück, praktisch für
einen Massenimport. Das **Bidirektionale** öffnet zwei unabhängige Streams über denselben Aufruf,
für Telemetrie oder eine Verhandlungsschleife, ohne Polling oder WebSocket-Bastelei.

## Deadlines, Abbruch und Statuscodes

Ein Netzwerkaufruf ohne Zeitgrenze ist ein Vorfall, der nur auf seinen Moment wartet. gRPC trägt den
Begriff der **Deadline** direkt im Protokoll: ein absoluter Zeitpunkt, keine Dauer, der mit dem
Aufruf übermittelt wird. Auf Clientseite übergibt man ihn dem Aufruf,
`deadline: DateTime.UtcNow.AddSeconds(2)`.

Läuft sie ab, löst sich `context.CancellationToken` auf dem Server aus, und der Client erhält eine
`RpcException` mit dem Status `DeadlineExceeded`. Das hat nichts mit einem rein clientseitigen
Timeout zu tun, der das Warten aufgibt, aber den Server ins Leere weiterarbeiten lässt. Dieses Token
an nachgelagerte Aufrufe weiterzugeben, an die Datenbank oder den nächsten Service, lässt den Abbruch
durch die gesamte Kette durchschlagen.

gRPC definiert außerdem einen geschlossenen Satz von **Statuscodes**: `NotFound`, `InvalidArgument`,
`PermissionDenied`, `Unavailable`, `Unauthenticated`. Der Server signalisiert einen fachlichen Fehler,
indem er `throw new RpcException(new Status(StatusCode.NotFound, "unknown sku"))` wirft, und der
Client reagiert darauf mit `catch (RpcException ex) when (ex.StatusCode == StatusCode.Unavailable)`.
Wo ein `500` bei REST ein Sammelbecken ist, dessen Bedeutung man erraten muss, ist der gRPC-Status
typisiert und lässt sich testen.

## Interceptoren für Querschnittsbelange

Logging, Metriken, Authentifizierung, Wiederholungsversuche: Diese Belange kehren bei jedem Aufruf
wieder. Ein **Interceptor** fasst sie zusammen, indem er die Handler umhüllt, das Äquivalent einer
Middleware für die gRPC-Pipeline. Man leitet von `Interceptor` ab und überschreibt das gewünschte
Glied, hier den unären Aufruf auf Serverseite.

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

Man registriert ihn einmal, `AddGrpc(o => o.Interceptors.Add<LoggingInterceptor>())`, und er deckt
alle Services ab. Denselben Mechanismus gibt es clientseitig über `.AddInterceptor<T>()`, um ein
Authentifizierungstoken oder eine Wiederholungsstrategie anzuhängen, ohne jeden Aufruf zu
verunreinigen.

## gRPC oder REST: eine informierte Wahl

gRPC ist nicht universell. Ein vom Compiler geprüfter Vertrag und ein kompaktes Binärformat über
HTTP/2 machen es vor allem für **internen** Traffic geeignet, von Service zu Service, dort, wo
beide Enden des Kanals in der eigenen Hand liegen. Das Full-Duplex-Streaming verstärkt diese
Positionierung.

Seine Grenzen sind konkret. Ein Browser spricht nicht nativ gRPC: Er hat keinen Zugriff auf die
HTTP/2-Trailer, von denen das Protokoll abhängt, und man muss über
[gRPC-Web](https://learn.microsoft.com/en-us/aspnet/core/grpc/grpcweb) mit einem Proxy gehen. Das
Binärformat lässt sich in Logs nicht auf einen Blick lesen, und das Debugging erfordert dedizierte
Werkzeuge.

Für eine **öffentliche** API, die Dritten zugänglich ist, bleibt REST/JSON oft die beste Wahl:
lesbar im Browser und auf HTTP-Ebene cachebar. Der
[gRPC-Leitfaden für .NET](https://learn.microsoft.com/en-us/aspnet/core/grpc/) beschreibt diese
Aufgabenteilung im Detail.

> Die gesunde Aufteilung: REST als öffentliche Fassade, gRPC im Inneren. Die .proto-Datei wird dann
> zur formalen Grenze zwischen den Services, einer versionierten und gemeinsam genutzten Grenze,
> die der Compiler an beiden Enden prüft.
