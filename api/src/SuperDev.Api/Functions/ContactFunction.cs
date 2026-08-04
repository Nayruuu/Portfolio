using System.Net;

using Microsoft.Extensions.Options;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

using SuperDev.Api.Http.Requests;
using SuperDev.Api.Http.Responses;

using SuperDev.Application.Models;
using SuperDev.Application.Handlers;

using SuperDev.Infrastructure.Configuration;

namespace SuperDev.Api.Functions;

public sealed class ContactFunction(ContactHandler handler, IOptions<ContactOptions> options)
{
    private const string Route = "contact";

    private readonly int _maxRequestBytes = options.Value.MaxRequestBytes;

    [Function(Route)]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = Route)] HttpRequestData request,
        CancellationToken cancellationToken)
    {
        var result = await ProcessAsync(request.Body, cancellationToken);

        return await result.ToResponseAsync(request, cancellationToken);
    }

    internal async Task<ApiResult> ProcessAsync(Stream body, CancellationToken cancellationToken)
    {
        var raw = await BoundedBody.ReadAsync(body, _maxRequestBytes, cancellationToken);

        if (raw is null)
        {
            return ApiResult.Empty(HttpStatusCode.RequestEntityTooLarge);
        }
        if (!JsonBody.TryParse<ContactRequest>(raw, out var payload))
        {
            return ApiResult.Errors(HttpStatusCode.BadRequest,
                new Dictionary<string, string[]> { ["body"] = ["malformed JSON"] });
        }

        var outcome = await handler.HandleAsync(payload, cancellationToken);

        return outcome.ToApiResult();
    }
}
