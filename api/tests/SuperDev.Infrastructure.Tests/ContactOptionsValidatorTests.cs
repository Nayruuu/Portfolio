using Microsoft.Extensions.Options;

using SuperDev.Infrastructure.Configuration;

namespace SuperDev.Infrastructure.Tests;

public sealed class ContactOptionsValidatorTests
{
    private static ContactOptions Valid() => new()
    {
        ResendApiKey = "re_test",
        From = "DoNotReply@super-dev.app",
        To = "inbox@super-dev.app",
    };

    private static ValidateOptionsResult Validate(ContactOptions options) =>
        new ContactOptionsValidator().Validate(null, options);

    [Fact]
    public void A_fully_configured_contact_section_passes()
    {
        Assert.True(Validate(Valid()).Succeeded);
    }

    [Fact]
    public void Bare_defaults_fail_because_key_sender_and_recipient_are_required()
    {
        Assert.True(Validate(new ContactOptions()).Failed);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void A_non_positive_body_cap_fails(int bytes)
    {
        Assert.True(Validate(Valid() with { MaxRequestBytes = bytes }).Failed);
    }

    [Fact]
    public void A_non_positive_rate_limit_fails()
    {
        Assert.True(Validate(Valid() with { RateLimitPerMinute = 0 }).Failed);
    }

    [Fact]
    public void A_missing_sender_or_recipient_fails_even_with_a_key()
    {
        Assert.True(Validate(Valid() with { From = "" }).Failed);
        Assert.True(Validate(Valid() with { To = "" }).Failed);
    }
}
