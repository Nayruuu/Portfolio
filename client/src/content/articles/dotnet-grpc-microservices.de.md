Zwischen Microservices bezahlt JSON über HTTP/1.1 seinen Komfort teuer: ausführliche
Serialisierung, kein starker Vertrag, eine Verbindung pro Aufruf. **gRPC** antwortet auf genau
diesen Kontext — kompaktes Binärformat über HTTP/2, ein geteilter Vertrag und generierter Code
auf beiden Seiten. In .NET ist die Integration erstklassig.

## Die .proto-Datei als einzige Quelle der Wahrheit

Alles beginnt mit einer `.proto`-Datei: Sie beschreibt die Nachrichten und den Service, unabhängig von der
Sprache. Das ist **der** Vertrag — weder Client noch Server schreiben ihn von Hand. Darin deklariert man
einen `service Pricing`, der einen `rpc GetQuote (QuoteRequest)`-Aufruf bereitstellt, der ein
`QuoteReply` zurückgibt. Jedes Feld ist nummeriert (`string sku = 1;`, `int32 quantity = 2;`) — diese
Nummern sind der Schlüssel zur Abwärtskompatibilität: Man darf sie niemals wiederverwenden.

Auf .NET-Seite referenziert man diese Datei im `.csproj` über `<Protobuf Include="pricing.proto" />`.
Das Package `Grpc.Tools` generiert dann zur Kompilierzeit die Server-Basisklasse und den
typisierten Client — keine DTOs müssen manuell kopiert werden:

```csharp
// Généré par Grpc.Tools à partir de pricing.proto — ne pas éditer
public partial class QuoteRequest
{
    public string Sku { get; set; }
    public int Quantity { get; set; }
}
```

## Typisierter Server und Client

Der Server leitet von der generierten Klasse `Pricing.PricingBase` ab und überschreibt die Methode. Kein
Routing muss verdrahtet werden, keine manuelle Deserialisierung: Man empfängt eine stark typisierte Nachricht.

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

Auf der aufrufenden Seite schreibt man ebenfalls keinen `HttpClient`. Man injiziert den generierten Client über
`AddGrpcClient` und ruft ihn wie eine lokale Methode auf:

```csharp
builder.Services.AddGrpcClient<Pricing.PricingClient>(options =>
    options.Address = new Uri("https://pricing:443"));
```

## Streaming als entscheidendes Argument

Wo REST an Grenzen stößt, glänzt gRPC: HTTP/2 ermöglicht **Streaming** in beide Richtungen.
Ein serverseitiger `stream` liefert Ergebnisse fortlaufend aus; ein bidirektionaler `stream`
öffnet einen Full-Duplex-Kanal, ideal für Telemetrie oder Chat. Man schreibt in einen
`IServerStreamWriter<T>` und der Client iteriert mit `await foreach` — ohne Polling, ohne
mühsam zusammengebauten WebSocket.

## gRPC vs. REST: eine bewusste Wahl treffen

gRPC ist nicht universell. Seine Stärken — kompaktes Binärformat, starker Vertrag, Streaming,
geringe Latenz — machen es zum idealen **internen** Werkzeug (Service-zu-Service). Seine Grenzen sind
real: Ein Browser spricht gRPC nicht nativ (man benötigt gRPC-Web und einen Proxy), das Binärformat
ist nicht mit bloßem Auge lesbar, und das Debugging erfordert dedizierte Tools. Für eine **öffentliche**
API, die von Dritten konsumiert wird, bleibt REST/JSON oft die richtige Wahl. Der Microsoft-Leitfaden
vergleicht beide in der
[doc gRPC pour .NET](https://learn.microsoft.com/en-us/aspnet/core/grpc/).

> Der gesunde Reflex: **REST als öffentliche Fassade, gRPC im Inneren**. Der .proto-Vertrag
> wird so zur formalen Grenze zwischen Ihren Services — versioniert, geteilt, vom Compiler geprüft.
