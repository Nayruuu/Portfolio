Entre deux microservices, exchanging JSON over HTTP/1.1 costs more than it seems: verbose
serialization, no contract the compiler can check, a connection reopened on every request.
**gRPC** targets this exact case with binary Protobuf over HTTP/2, a shared contract and
generated code on both sides. In .NET, the `Grpc.AspNetCore` stack makes it a first-class
integration, with no third-party dependency to bolt on.

## The .proto contract, single source of truth

Everything starts from a `.proto` file that describes the messages and the service independently
of the language. This is **the** contract, and neither the client nor the server hand-copy its
types. The [proto3 syntax](https://protobuf.dev/programming-guides/proto3/) fits in a few words: a
`service`, some `rpc`, `message`s whose every field carries a number.

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

These numbers are the fields' identity on the wire: one is never reused, even after removing the
field that carried it. This is what makes an old binary readable by a newer schema, backward
compatibility by construction. The `stream` keyword, placed on the input, the output, or both,
describes the four call shapes.

In the `.csproj`, one line is enough: `<Protobuf Include="Protos/pricing.proto" GrpcServices="Both" />`.
At compile time, `Grpc.Tools` runs `protoc` and generates the message classes, the server base
class `Pricing.PricingBase` and the client `Pricing.PricingClient`. The proto's `snake_case`
becomes `PascalCase` in C#, `unit_price_cents` reads as `UnitPriceCents`. No DTO to write, none to
keep in sync twice over.

## Typed server and client

The server derives from the generated class and overrides the method. No routing to wire up, no
manual deserialization: a strongly-typed message comes in, a typed message goes back out.

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

The server wiring fits in two lines in `Program.cs`: `builder.Services.AddGrpc();` then
`app.MapGrpcService<PricingService>();`. On the calling side, `Grpc.Net.Client` provides the
channel, and registration goes through dependency injection,
`AddGrpcClient<Pricing.PricingClient>(o => o.Address = new Uri("https://pricing:443"))`. The
injected client is called like a local method; underneath, a single HTTP/2 connection multiplexes
concurrent calls rather than reopening one per request.

## The four call shapes

The **unary** call (one request, one reply) covers most of the traffic and closely resembles a
REST call. The other three shapes exploit HTTP/2's ability to keep a stream open, something REST
doesn't do natively.

**Server streaming** pushes a sequence of messages over a single request: the server writes to an
`IServerStreamWriter<T>`, the client iterates with `await foreach`.

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

**Client streaming** reverses the direction: the client sends a stream, the server reads it via
an `IAsyncStreamReader<T>` and returns a single summary, handy for a bulk import. The
**bidirectional** shape opens two independent streams over the same call, for telemetry or a
negotiation loop, with no polling or WebSocket to hack together.

## Deadlines, cancellation and statuses

A network call with no time bound is an incident waiting to happen. gRPC carries the notion of a
**deadline** in the protocol itself: an absolute instant, not a duration, sent along with the
call. On the client, it's passed to the call, `deadline: DateTime.UtcNow.AddSeconds(2)`.

When it expires, the server's `context.CancellationToken` fires and the client receives an
`RpcException` with status `DeadlineExceeded`. This is nothing like a purely client-side timeout,
which gives up waiting but leaves the server working into the void. Passing this token down to
downstream calls, a database or the next service, propagates the abandonment through the whole
chain.

gRPC also defines a closed set of **status codes**: `NotFound`, `InvalidArgument`,
`PermissionDenied`, `Unavailable`, `Unauthenticated`. The server signals a business failure by
throwing `throw new RpcException(new Status(StatusCode.NotFound, "unknown sku"))`, and the client
branches on it with `catch (RpcException ex) when (ex.StatusCode == StatusCode.Unavailable)`.
Where a REST `500` is a catch-all whose meaning has to be guessed, the gRPC status is typed and
testable.

## Interceptors for cross-cutting concerns

Logging, metrics, authentication, retries: these concerns come up on every call. An
**interceptor** factors them out by wrapping the handlers, the equivalent of a middleware for the
gRPC pipeline. You derive from `Interceptor` and override the desired hook, here the unary call on
the server side.

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

It's registered once, `AddGrpc(o => o.Interceptors.Add<LoggingInterceptor>())`, and it covers all
services. The same mechanism exists on the client side via `.AddInterceptor<T>()`, to attach an
authentication token or a retry policy without polluting every call.

## gRPC or REST: choosing knowingly

gRPC isn't universal. A contract the compiler checks and a compact binary over HTTP/2 make it
suited first to **internal**, service-to-service traffic, where you control both ends of the
channel. Full-duplex streaming reinforces this positioning.

Its limits are concrete. A browser doesn't speak gRPC natively: it can't access the HTTP/2
trailers the protocol depends on, and you have to go through
[gRPC-Web](https://learn.microsoft.com/en-us/aspnet/core/grpc/grpcweb) with a proxy. The binary
isn't human-readable in logs, and debugging calls for dedicated tools.

For a **public** API exposed to third parties, REST/JSON often remains the better choice:
readable in a browser and cacheable at the HTTP level. The
[gRPC for .NET guide](https://learn.microsoft.com/en-us/aspnet/core/grpc/) details this division
of roles.

> The healthy split: REST as the public front, gRPC on the inside. The .proto file then becomes
> the formal boundary between your services, a versioned and shared boundary that the compiler
> checks on both ends.
