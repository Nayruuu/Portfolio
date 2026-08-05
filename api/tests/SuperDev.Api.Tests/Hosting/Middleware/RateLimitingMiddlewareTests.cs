using System.Net;

using Microsoft.Azure.Functions.Worker.Http;

using SuperDev.Api.Middleware;
using SuperDev.Api.Tests.Fakes;

using SuperDev.Application.Throttling;

namespace SuperDev.Api.Tests.Middleware;

public sealed class RateLimitingMiddlewareTests
{
    private static FakeHttpRequestData Request(HttpHeadersCollection? headers = null)
    {
        var request = new FakeHttpRequestData(new FakeFunctionContext(), Stream.Null);

        if (headers is not null)
        {
            foreach (var header in headers)
            {
                request.Headers.Add(header.Key, header.Value);
            }
        }

        return request;
    }

    private static RateLimitingMiddleware With(IRateLimiter? limiter) =>
        new(new StubRateLimitPolicy(limiter));

    [Fact]
    public void An_allowed_caller_is_not_throttled()
    {
        var middleware = With(new StubRateLimiter(allow: true));

        Assert.Null(middleware.Throttle(Request()));
    }

    [Fact]
    public void A_denied_caller_is_throttled_with_429()
    {
        var middleware = With(new StubRateLimiter(allow: false));

        var rejection = middleware.Throttle(Request());

        Assert.NotNull(rejection);
        Assert.Equal(HttpStatusCode.TooManyRequests, rejection.StatusCode);
    }

    [Fact]
    public void A_route_without_a_configured_limiter_is_never_throttled()
    {
        // e.g. the altcha challenge GET — no bucket configured for its route, so it is always free.
        var middleware = With(limiter: null);

        Assert.Null(middleware.Throttle(Request()));
        Assert.Null(middleware.Throttle(new FakeHttpRequestData(new FakeFunctionContext(), Stream.Null, "GET")));
    }

    [Fact]
    public void A_get_on_a_rate_limited_route_is_throttled_too()
    {
        // Reads share the route's bucket: the feedback tally GET is a full-partition scan.
        var middleware = With(new StubRateLimiter(allow: false));
        var get = new FakeHttpRequestData(new FakeFunctionContext(), Stream.Null, "GET");

        Assert.Equal(HttpStatusCode.TooManyRequests, middleware.Throttle(get)?.StatusCode);
    }

    [Fact]
    public void The_client_hop_behind_the_swa_egress_is_used_as_the_caller_key()
    {
        var limiter = new RecordingRateLimiter(allow: true);
        var middleware = With(limiter);
        var headers = new HttpHeadersCollection
        {
            { "X-Forwarded-For", "82.228.227.194:37623, 13.69.116.6:6539" },
        };

        middleware.Throttle(Request(headers));

        Assert.Equal("82.228.227.194", limiter.LastKey);
    }

    [Fact]
    public async Task An_allowed_request_flows_through_to_the_next_middleware()
    {
        var context = new FakeFunctionContext();
        context.SetHttpRequest(new FakeHttpRequestData(context, Stream.Null));
        var middleware = With(new StubRateLimiter(allow: true));
        var reached = false;

        await middleware.Invoke(context, _ =>
        {
            reached = true;

            return Task.CompletedTask;
        });

        Assert.True(reached);
    }
}
