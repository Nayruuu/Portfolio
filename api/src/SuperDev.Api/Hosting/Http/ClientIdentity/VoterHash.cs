using System.Text;
using System.Security.Cryptography;

using Microsoft.Azure.Functions.Worker.Http;

namespace SuperDev.Api.Http.ClientIdentity;

internal static class VoterHash
{
    // Not a secret — only keeps the stored per-page voter key from trivially reversing to a raw IP.
    private const string Salt = "super-dev.app/feedback/v1|";

    public static string Of(HttpHeadersCollection headers) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Salt + headers.CallerKey())));
}
