Entre dos microservicios, intercambiar JSON sobre HTTP/1.1 cuesta más de lo que parece:
serialización verbosa, ningún contrato que el compilador pueda verificar, una conexión
reabierta en cada petición. **gRPC** apunta precisamente a este caso con Protobuf binario sobre HTTP/2, un
contrato compartido y código generado en ambos lados. En .NET, la pila `Grpc.AspNetCore` convierte esto en una
integración de primera clase, sin dependencia de terceros que añadir.

## El contrato .proto, fuente única de verdad

Todo parte de un archivo `.proto` que describe los mensajes y el servicio independientemente del lenguaje.
Es **el** contrato, y ni el cliente ni el servidor copian sus tipos a mano. La
[sintaxis proto3](https://protobuf.dev/programming-guides/proto3/) cabe en pocas palabras: un
`service`, unos `rpc`, unos `message` cuyos campos llevan cada uno un número.

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

Estos números son la identidad de los campos en el cable: nunca se reutiliza uno, incluso después de
haber eliminado el campo que lo llevaba. Esto es lo que hace que un binario antiguo sea legible por un esquema
más reciente, la compatibilidad ascendente por construcción. La palabra clave `stream`, colocada en
la entrada, la salida o ambas, describe las cuatro formas de llamada.

En el `.csproj`, una línea basta: `<Protobuf Include="Protos/pricing.proto" GrpcServices="Both" />`.
En la compilación, `Grpc.Tools` lanza `protoc` y genera las clases de mensajes, la clase base
del servidor `Pricing.PricingBase` y el cliente `Pricing.PricingClient`. El `snake_case` del proto se convierte
en `PascalCase` en C#, `unit_price_cents` se lee `UnitPriceCents`. Ningún DTO que escribir, ninguno que mantener
duplicado.

## Servidor y cliente tipados

El servidor deriva de la clase generada y redefine el método. Nada de routing que cablear, ninguna
deserialización manual: llega un mensaje fuertemente tipado, sale un mensaje tipado.

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

El cableado del servidor cabe en dos líneas en `Program.cs`: `builder.Services.AddGrpc();` luego
`app.MapGrpcService<PricingService>();`. Del lado llamante, `Grpc.Net.Client` proporciona el canal, y
el registro pasa por la inyección de dependencias,
`AddGrpcClient<Pricing.PricingClient>(o => o.Address = new Uri("https://pricing:443"))`. El cliente
inyectado se llama como un método local; por debajo, una única conexión HTTP/2 multiplexa las
llamadas concurrentes en lugar de reabrir una en cada petición.

## Las cuatro formas de llamada

La llamada **unaria** (una petición, una respuesta) cubre lo esencial del tráfico y se parece mucho a
una llamada REST. Las otras tres formas explotan la capacidad de HTTP/2 de mantener un flujo abierto, algo
que REST no hace de forma nativa.

El **server streaming** empuja una sucesión de mensajes en una sola petición: el servidor escribe en
un `IServerStreamWriter<T>`, el cliente itera con `await foreach`.

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

El **client streaming** invierte el sentido: el cliente envía un flujo, el servidor lo lee mediante un
`IAsyncStreamReader<T>` y devuelve un único resumen, práctico para una importación masiva. El
**bidireccional** abre dos flujos independientes en la misma llamada, para telemetría o un
bucle de negociación, sin polling ni WebSocket que improvisar.

## Deadlines, cancelación y estados

Una llamada de red sin límite de tiempo es un incidente que espera su momento. gRPC lleva la noción de
**deadline** en el protocolo: un instante absoluto, no una duración, transmitido con la llamada. En el
cliente, se pasa a la llamada, `deadline: DateTime.UtcNow.AddSeconds(2)`.

Cuando expira, el `context.CancellationToken` del servidor se dispara y el cliente recibe una
`RpcException` de estado `DeadlineExceeded`. Nada que ver con un timeout puramente de cliente, que
abandona la espera pero deja al servidor trabajando en el vacío. Pasar este token a las llamadas
posteriores, base de datos o siguiente servicio, propaga el abandono a través de toda la cadena.

gRPC define también un conjunto cerrado de **códigos de estado**: `NotFound`, `InvalidArgument`,
`PermissionDenied`, `Unavailable`, `Unauthenticated`. El servidor señala un fallo de negocio lanzando
`throw new RpcException(new Status(StatusCode.NotFound, "unknown sku"))`, y el cliente engancha
en él con `catch (RpcException ex) when (ex.StatusCode == StatusCode.Unavailable)`. Donde un `500`
de REST es un cajón de sastre cuyo sentido hay que adivinar, el estado gRPC está tipado y se testea.

## Interceptores para lo transversal

Registro, métricas, autenticación, reintentos: estas preocupaciones se repiten en cada
llamada. Un **interceptor** las factoriza envolviendo los handlers, el equivalente de un middleware
para el pipeline gRPC. Se deriva de `Interceptor` y se redefine el eslabón deseado, aquí la llamada
unaria del lado servidor.

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

Se registra una vez, `AddGrpc(o => o.Interceptors.Add<LoggingInterceptor>())`, y cubre
todos los servicios. El mismo mecanismo existe del lado cliente vía `.AddInterceptor<T>()`, para adjuntar
un token de autenticación o una política de reintentos sin ensuciar cada llamada.

## gRPC o REST: elegir con conocimiento de causa

gRPC no es universal. Un contrato que el compilador verifica y un binario compacto sobre HTTP/2 lo
destinan primero al tráfico **interno**, de servicio a servicio, donde ambos extremos del canal
son suyos. El streaming full-duplex refuerza este posicionamiento.

Sus límites son concretos. Un navegador no habla gRPC de forma nativa: no accede a los
trailers de HTTP/2 de los que depende el protocolo, y hay que pasar por
[gRPC-Web](https://learn.microsoft.com/en-us/aspnet/core/grpc/grpcweb) con un proxy. El binario no
se lee a simple vista en los logs, y la depuración requiere herramientas dedicadas.

Para una API **pública** expuesta a terceros, REST/JSON sigue siendo a menudo la mejor opción: legible
en un navegador y cacheable a nivel HTTP. La
[guía de gRPC para .NET](https://learn.microsoft.com/en-us/aspnet/core/grpc/) detalla este reparto de
roles.

> El reparto sano: REST en la fachada pública, gRPC en el interior. El archivo .proto se convierte entonces en la
> frontera formal entre sus servicios, una frontera versionada y compartida, que el compilador
> verifica en ambos extremos.
