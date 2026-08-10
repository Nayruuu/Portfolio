namespace SuperDev.Infrastructure.Features.Feedback;

public sealed record FeedbackOptions
{
    public const string Section = "Feedback";

    // Covers the tally GET (per load + nav) and the vote POST for one route — far looser than
    // Contact's email throttle, since each op is cheap and idempotent.
    public int RateLimitPerMinute { get; init; } = 60;
}
