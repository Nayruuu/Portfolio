namespace SuperDev.Application.Features.Feedback;

/// <summary>A validated feedback action: a <see cref="Vote"/> of "up"/"down", or null to retract.</summary>
public sealed record FeedbackCommand(string Page, string? Vote);
