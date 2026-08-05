namespace SuperDev.Api.Http.Requests;

internal static class BoundedBody
{
    public static async Task<byte[]?> ReadAsync(
        Stream body, int maxBytes, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int read;

        while ((read = await body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > maxBytes)
            {
                return null;
            }
            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }
}
