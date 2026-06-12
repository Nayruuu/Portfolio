## El contrato .proto, fuente única de verdad

Todo parte de un archivo `.proto`: describe los mensajes y el servicio, con independencia del
lenguaje. Es **el** contrato — ni el cliente ni el servidor lo escriben a mano. Se declara un
`service Pricing` que expone una llamada `rpc GetQuote (QuoteRequest)` que devuelve un
`QuoteReply`, con cada campo numerado (`string sku = 1;`, `int32 quantity = 2;`) — estos
números son la clave de la compatibilidad ascendente: nunca se reutiliza uno.

En .NET, se referencia este archivo en el `.csproj` mediante `<Protobuf Include="pricing.proto" />`.
El paquete `Grpc.Tools` genera entonces, en tiempo de compilación, la clase base del servidor y el
cliente tipado — ningún DTO que copiar:

```csharp
// Généré par Grpc.Tools à partir de pricing.proto — ne pas éditer
public partial class QuoteRequest
{
    public string Sku { get; set; }
    public int Quantity { get; set; }
}
```

## Servidor y cliente tipados

El servidor deriva de la clase generada `Pricing.PricingBase` y sobreescribe el método. Sin
enrutamiento que cablear, sin deserialización manual: se recibe un mensaje fuertemente tipado.

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

Del lado del llamador, tampoco se escribe un `HttpClient`. Se inyecta el cliente generado mediante
`AddGrpcClient`, y se llama como un método local:

```csharp
builder.Services.AddGrpcClient<Pricing.PricingClient>(options =>
    options.Address = new Uri("https://pricing:443"));
```

## El streaming, el argumento decisivo

Donde REST llega a su límite, gRPC sobresale: HTTP/2 permite el **streaming** en ambos sentidos.
Un `stream` del lado del servidor envía resultados a medida que se producen; un `stream` bidireccional
abre un canal full-duplex ideal para telemetría o chat. Se escribe en un
`IServerStreamWriter<T>` y el cliente itera con `await foreach` — sin polling, sin
WebSocket que improvisar.

## gRPC frente a REST: elegir con conocimiento de causa

gRPC no es universal. Sus puntos fuertes — binario compacto, contrato sólido, streaming,
baja latencia — lo convierten en la herramienta **interna** por excelencia (servicio a servicio). Sus limitaciones
son reales: un navegador no habla gRPC de forma nativa (se necesita gRPC-Web y un proxy), el
binario no es legible a simple vista, y la depuración requiere herramientas dedicadas. Para una API
**pública** consumida por terceros, REST/JSON sigue siendo a menudo la mejor opción. La guía
de Microsoft compara ambos en la
[doc gRPC para .NET](https://learn.microsoft.com/en-us/aspnet/core/grpc/).

> El reflejo sano: **REST en la fachada pública, gRPC en el interior**. El contrato .proto
> se convierte entonces en la frontera formal entre sus servicios — versionado, compartido, verificado
> por el compilador.
