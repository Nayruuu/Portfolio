using SuperDev.Api.Http.ClientIdentity;

namespace SuperDev.Api.Tests.Http;

public sealed class ForwardedForTests
{
    [Fact]
    public void Null_header_yields_the_unknown_bucket()
    {
        Assert.Equal("unknown", ForwardedFor.ClientKey(null));
    }

    [Fact]
    public void A_single_hop_is_returned_as_is()
    {
        Assert.Equal("1.2.3.4", ForwardedFor.ClientKey(["1.2.3.4"]));
    }

    [Fact]
    public void A_spoofed_left_token_is_ignored_the_trusted_rightmost_hop_wins()
    {
        Assert.Equal("1.2.3.4", ForwardedFor.ClientKey(["9.9.9.9, 1.2.3.4"]));
    }

    [Fact]
    public void Multiple_header_lines_are_flattened_rightmost_last()
    {
        Assert.Equal("1.2.3.4", ForwardedFor.ClientKey(["9.9.9.9", "8.8.8.8, 1.2.3.4"]));
    }

    [Fact]
    public void A_trailing_empty_token_does_not_become_the_key()
    {
        Assert.Equal("1.2.3.4", ForwardedFor.ClientKey(["1.2.3.4, "]));
    }

    [Fact]
    public void Blank_values_fall_back_to_unknown()
    {
        Assert.Equal("unknown", ForwardedFor.ClientKey(["", "  "]));
    }
}
