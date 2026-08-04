using System.Net;

using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Azure.Functions.Worker.Middleware;

using SuperDev.Api.Http.ClientIdentity;

using SuperDev.Application.Abstractions;

namespace SuperDev.Api.Middleware;

internal sealed class RateLimitingMiddleware(IRateLimiter limiter) : IFunctionsWorkerMiddleware
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

    internal HttpResponseData? Throttle(HttpRequestData request) =>
        limiter.TryAcquire(request.Headers.CallerKey())
            ? null
            : request.CreateResponse(HttpStatusCode.TooManyRequests);
}
