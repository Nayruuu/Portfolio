using System.Net;
using System.Web;

using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

using SuperDev.Api.Http.Requests;
using SuperDev.Api.Http.Responses;
using SuperDev.Api.Http.ClientIdentity;

using SuperDev.Application.Features.Feedback;

namespace SuperDev.Api.Features.Feedback;

public sealed class FeedbackFunction(FeedbackHandler handler)
{
    private const string Route = "feedback";
    private const int MaxRequestBytes = 2 * 1024;

    [Function(Route)]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", Route = Route)] HttpRequestData request,
        CancellationToken cancellationToken)
    {
        var voter = VoterHash.Of(request.Headers);
        var result = IsGet(request)
            ? await ReadAsync(request.Url, voter, cancellationToken)
            : await ProcessAsync(request.Body, voter, cancellationToken);

        return await result.ToResponseAsync(request, cancellationToken);
    }

    internal async Task<ApiResult> ReadAsync(Uri url, string voter, CancellationToken cancellationToken)
    {
        var page = HttpUtility.ParseQueryString(url.Query).Get("page");

        return ApiResult.Json(HttpStatusCode.OK, await handler.CountAsync(page, voter, cancellationToken));
    }

    internal async Task<ApiResult> ProcessAsync(Stream body, string voter, CancellationToken cancellationToken)
    {
        var raw = await BoundedBody.ReadAsync(body, MaxRequestBytes, cancellationToken);

        if (raw is null)
        {
            return ApiResult.Empty(HttpStatusCode.RequestEntityTooLarge);
        }
        if (!JsonBody.TryParse<FeedbackRequest>(raw, out var payload))
        {
            return ApiResult.Errors(HttpStatusCode.BadRequest,
                new Dictionary<string, string[]> { ["body"] = ["malformed JSON"] });
        }

        return (await handler.HandleAsync(payload, voter, cancellationToken)).ToApiResult();
    }

    private static bool IsGet(HttpRequestData request) =>
        string.Equals(request.Method, "GET", StringComparison.OrdinalIgnoreCase);
}
