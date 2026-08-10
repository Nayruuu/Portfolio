using System.Text.Json;

namespace SuperDev.Api.Http.Requests;

internal static class JsonBody
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static bool TryParse<T>(byte[] raw, out T? value)
    {
        try
        {
            value = JsonSerializer.Deserialize<T>(raw, Options);

            return true;
        }
        catch (JsonException)
        {
            value = default;

            return false;
        }
    }
}
