using Microsoft.Extensions.Options;

namespace SuperDev.Infrastructure.Features.Feedback;

public sealed class FeedbackOptionsValidator : IValidateOptions<FeedbackOptions>
{
    public ValidateOptionsResult Validate(string? name, FeedbackOptions options) =>
        options.RateLimitPerMinute <= 0
            ? ValidateOptionsResult.Fail("Feedback:RateLimitPerMinute must be greater than 0.")
            : ValidateOptionsResult.Success;
}
