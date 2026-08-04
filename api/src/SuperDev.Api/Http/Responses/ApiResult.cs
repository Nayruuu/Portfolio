using System.Net;

namespace SuperDev.Api.Http.Responses;

internal sealed record ApiResult(HttpStatusCode Status, object? Body)
{
    public static ApiResult Empty(HttpStatusCode status) => new(status, null);

    public static ApiResult Errors(
        HttpStatusCode status, IReadOnlyDictionary<string, string[]> errors) => new(status, new { errors });

    public static ApiResult Detail(HttpStatusCode status, string detail) => new(status, new { detail });
}
