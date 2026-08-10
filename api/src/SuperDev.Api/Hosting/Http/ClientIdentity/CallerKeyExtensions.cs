using Microsoft.Azure.Functions.Worker.Http;

namespace SuperDev.Api.Http.ClientIdentity;

internal static class CallerKeyExtensions
{
    private const string ForwardedForHeader = "X-Forwarded-For";

    public static string CallerKey(this HttpHeadersCollection headers) =>
        ForwardedFor.ClientKey(
            headers.TryGetValues(ForwardedForHeader, out var forwarded) ? forwarded : null);
}
