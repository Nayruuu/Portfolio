using SuperDev.Infrastructure.Features.Feedback;

namespace SuperDev.Infrastructure.Tests.Features.Feedback;

public sealed class FeedbackOptionsValidatorTests
{
    private static bool Passes(FeedbackOptions options) =>
        new FeedbackOptionsValidator().Validate(null, options).Succeeded;

    [Fact]
    public void The_generous_default_budget_passes()
    {
        Assert.True(Passes(new FeedbackOptions()));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void A_non_positive_rate_limit_fails(int perMinute)
    {
        Assert.False(Passes(new FeedbackOptions { RateLimitPerMinute = perMinute }));
    }
}
