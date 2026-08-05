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
    public void A_direct_hit_single_hop_keys_on_that_client_ip()
    {
        Assert.Equal("82.228.227.194", ForwardedFor.ClientKey(["82.228.227.194:36478"]));
    }

    [Fact]
    public void The_swa_path_keys_on_the_real_client_not_the_rotating_egress()
    {
        Assert.Equal(
            "82.228.227.194",
            ForwardedFor.ClientKey(["82.228.227.194:37623, 13.69.116.6:6539"]));
        Assert.Equal(
            "82.228.227.194",
            ForwardedFor.ClientKey(["82.228.227.194:36416, 13.69.116.11:63930"]));
    }

    [Fact]
    public void A_spoofed_left_token_cannot_shift_the_key_off_the_trusted_client_hop()
    {
        Assert.Equal(
            "82.228.227.194",
            ForwardedFor.ClientKey(["9.9.9.9, 82.228.227.194:37623, 13.69.116.6:6539"]));
    }

    [Fact]
    public void Multiple_header_lines_are_flattened_before_the_client_hop_is_picked()
    {
        Assert.Equal("1.2.3.4", ForwardedFor.ClientKey(["9.9.9.9", "1.2.3.4:5000, 13.69.116.6:6539"]));
    }

    [Fact]
    public void An_ipv6_client_hop_keeps_its_address_and_drops_the_port()
    {
        Assert.Equal(
            "2001:db8::1",
            ForwardedFor.ClientKey(["[2001:db8::1]:443, 13.69.116.6:6539"]));
    }

    [Fact]
    public void A_trailing_empty_token_does_not_shift_the_key()
    {
        Assert.Equal("1.2.3.4", ForwardedFor.ClientKey(["1.2.3.4:5000, "]));
    }

    [Fact]
    public void Blank_values_fall_back_to_unknown()
    {
        Assert.Equal("unknown", ForwardedFor.ClientKey(["", "  "]));
    }
}
