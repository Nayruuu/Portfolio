namespace SuperDev.Api.Http.ClientIdentity;

internal static class ForwardedFor
{
    private const string Unknown = "unknown";

    public static string ClientKey(IEnumerable<string>? headerValues)
    {
        if (headerValues is null)
        {
            return Unknown;
        }

        var rightmostHop = headerValues
            .SelectMany(value => value.Split(','))
            .Select(hop => hop.Trim())
            .LastOrDefault(hop => hop.Length > 0);

        return string.IsNullOrEmpty(rightmostHop) ? Unknown : rightmostHop;
    }
}
