namespace SuperDev.Application.Features.Feedback;

/// <summary>Aggregate up/down counts for a page, plus the requesting voter's own vote (or null).</summary>
public sealed record VoteTally(int Up, int Down, string? Mine);
