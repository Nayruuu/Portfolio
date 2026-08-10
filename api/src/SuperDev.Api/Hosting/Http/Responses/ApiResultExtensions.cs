using Microsoft.Azure.Functions.Worker.Http;

namespace SuperDev.Api.Http.Responses;

internal static class ApiResultExtensions
{
    public static async Task<HttpResponseData> ToResponseAsync(
        this ApiResult result, HttpRequestData request, CancellationToken cancellationToken)
    {
        var response = request.CreateResponse();

        if (result.Body is not null)
        {
            await response.WriteAsJsonAsync(result.Body, cancellationToken);
        }
        response.StatusCode = result.Status;

        return response;
    }
}
