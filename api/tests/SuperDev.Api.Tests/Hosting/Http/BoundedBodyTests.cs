using System.Text;

using SuperDev.Api.Http.Requests;

namespace SuperDev.Api.Tests.Http;

public sealed class BoundedBodyTests
{
    [Fact]
    public async Task A_body_within_the_cap_is_read_in_full()
    {
        var payload = Encoding.UTF8.GetBytes("hello");
        using var stream = new MemoryStream(payload);

        var read = await BoundedBody.ReadAsync(stream, maxBytes: 16, CancellationToken.None);

        Assert.Equal(payload, read);
    }

    [Fact]
    public async Task A_body_exactly_at_the_cap_is_accepted()
    {
        var payload = new byte[16];
        using var stream = new MemoryStream(payload);

        var read = await BoundedBody.ReadAsync(stream, maxBytes: 16, CancellationToken.None);

        Assert.NotNull(read);
        Assert.Equal(16, read!.Length);
    }

    [Fact]
    public async Task A_body_over_the_cap_is_rejected_as_null()
    {
        var payload = new byte[17];
        using var stream = new MemoryStream(payload);

        var read = await BoundedBody.ReadAsync(stream, maxBytes: 16, CancellationToken.None);

        Assert.Null(read);
    }

    [Fact]
    public async Task An_oversized_body_stops_reading_early_instead_of_draining_the_stream()
    {
        var payload = new byte[1_000_000];
        using var stream = new MemoryStream(payload);

        var read = await BoundedBody.ReadAsync(stream, maxBytes: 16, CancellationToken.None);

        Assert.Null(read);
        Assert.True(stream.Position < 1_000_000);
    }
}
