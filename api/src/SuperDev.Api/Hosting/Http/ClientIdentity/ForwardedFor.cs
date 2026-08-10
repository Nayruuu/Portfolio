namespace SuperDev.Api.Http.ClientIdentity;

// The page calls the Function App directly: App Service appends the real client address as the LAST hop,
// after whatever the caller sent, so only that hop can be trusted.
internal static class ForwardedFor
{
    private const string Unknown = "unknown";

    public static string ClientKey(IEnumerable<string>? headerValues)
    {
        if (headerValues is null)
        {
            return Unknown;
        }

        var hops = headerValues
            .SelectMany(value => value.Split(','))
            .Select(hop => StripPort(hop.Trim()))
            .Where(hop => hop.Length > 0)
            .ToArray();

        if (hops.Length == 0)
        {
            return Unknown;
        }

        return hops[^1];
    }

    private static string StripPort(string hop)
    {
        if (hop.StartsWith('['))
        {
            var close = hop.IndexOf(']');

            return close > 0 ? hop[1..close] : hop;
        }

        var colon = hop.IndexOf(':');

        return colon > 0 && colon == hop.LastIndexOf(':') ? hop[..colon] : hop;
    }
}
