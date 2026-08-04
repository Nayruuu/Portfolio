using System.Net;

using Microsoft.Azure.Functions.Worker.Http;

using SuperDev.Api.Middleware;
using SuperDev.Api.Tests.Fakes;

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

    [Fact]
    public void An_allowed_caller_is_not_throttled()
    {
        var middleware = new RateLimitingMiddleware(new StubRateLimiter(allow: true));

        Assert.Null(middleware.Throttle(Request()));
    }

    [Fact]
    public void A_denied_caller_is_throttled_with_429()
    {
        var middleware = new RateLimitingMiddleware(new StubRateLimiter(allow: false));

        var rejection = middleware.Throttle(Request());

        Assert.NotNull(rejection);
        Assert.Equal(HttpStatusCode.TooManyRequests, rejection.StatusCode);
    }

    [Fact]
    public void The_rightmost_forwarded_for_hop_is_used_as_the_caller_key()
    {
        var limiter = new RecordingRateLimiter(allow: true);
        var middleware = new RateLimitingMiddleware(limiter);
        var headers = new HttpHeadersCollection { { "X-Forwarded-For", "9.9.9.9, 1.2.3.4" } };

        middleware.Throttle(Request(headers));

        Assert.Equal("1.2.3.4", limiter.LastKey);
    }

    [Fact]
    public async Task An_allowed_request_flows_through_to_the_next_middleware()
    {
        var context = new FakeFunctionContext();
        context.SetHttpRequest(new FakeHttpRequestData(context, Stream.Null));
        var middleware = new RateLimitingMiddleware(new StubRateLimiter(allow: true));
        var reached = false;

        await middleware.Invoke(context, _ =>
        {
            reached = true;

            return Task.CompletedTask;
        });

        Assert.True(reached);
    }
}
