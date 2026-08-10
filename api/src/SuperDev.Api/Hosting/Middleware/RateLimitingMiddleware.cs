using System.Net;

using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Azure.Functions.Worker.Middleware;

using SuperDev.Api.Http.ClientIdentity;

using SuperDev.Application.Throttling;

namespace SuperDev.Api.Middleware;

internal sealed class RateLimitingMiddleware(IRateLimitPolicy policy) : IFunctionsWorkerMiddleware
{
    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        var request = await context.GetHttpRequestDataAsync();
        var rejection = request is null ? null : Throttle(request);

        if (rejection is not null)
        {
            context.GetInvocationResult().Value = rejection;

            return;
        }

        await next(context);
    }

    // By route, not method: reads share the bucket (the tally GET scans a full partition); a route
    // with no configured limiter (the altcha challenge GET) is never throttled.
    internal HttpResponseData? Throttle(HttpRequestData request)
    {
        var limiter = policy.LimiterFor(request.Url.Segments[^1].Trim('/'));

        return limiter is null || limiter.TryAcquire(request.Headers.CallerKey())
            ? null
            : request.CreateResponse(HttpStatusCode.TooManyRequests);
    }
}
