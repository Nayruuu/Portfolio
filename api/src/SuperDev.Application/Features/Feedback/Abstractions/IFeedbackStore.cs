namespace SuperDev.Application.Features.Feedback;

/// <summary>
/// Persists one vote per (page, voter) and returns aggregate tallies. <c>voter</c> is an opaque,
/// already-hashed caller identity; a null <c>vote</c> retracts the voter's vote.
/// </summary>
public interface IFeedbackStore
{
    public Task<VoteTally> ApplyAsync(
        string page, string voter, string? vote, CancellationToken cancellationToken);

    public Task<VoteTally> GetAsync(string page, string voter, CancellationToken cancellationToken);
}
