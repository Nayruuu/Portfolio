namespace SuperDev.Application.Features.Feedback;

public abstract record FeedbackOutcome
{
    public sealed record Recorded(VoteTally Tally) : FeedbackOutcome;

    public sealed record Invalid(string Error) : FeedbackOutcome;
}
