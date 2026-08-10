using System.Net;

using Microsoft.Extensions.Logging;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Azure.Functions.Worker.Middleware;

using SuperDev.Api.Http.Responses;

namespace SuperDev.Api.Middleware;

internal sealed partial class ExceptionHandlingMiddleware(ILogger<ExceptionHandlingMiddleware> logger)
    : IFunctionsWorkerMiddleware
{
    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        try
        {
            await next(context);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            LogUnhandled(logger, exception);

            var request = await context.GetHttpRequestDataAsync();

            if (request is null)
            {
                throw;
            }

            context.GetInvocationResult().Value =
                await BuildErrorResponse(request, context.CancellationToken);
        }
    }

    internal static Task<HttpResponseData> BuildErrorResponse(
        HttpRequestData request, CancellationToken cancellationToken) =>
        ApiResult.Detail(HttpStatusCode.InternalServerError, "An unexpected error occurred.")
            .ToResponseAsync(request, cancellationToken);

    [LoggerMessage(Level = LogLevel.Error, Message = "Unhandled error in a function invocation")]
    private static partial void LogUnhandled(ILogger logger, Exception exception);
}
