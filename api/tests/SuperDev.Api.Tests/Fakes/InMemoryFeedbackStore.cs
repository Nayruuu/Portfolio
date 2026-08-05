using SuperDev.Application.Features.Feedback;

namespace SuperDev.Api.Tests.Fakes;

public sealed class InMemoryFeedbackStore : IFeedbackStore
{
    private readonly Dictionary<(string Page, string Voter), string> _votes = [];

    public Task<VoteTally> ApplyAsync(
        string page, string voter, string? vote, CancellationToken cancellationToken)
    {
        if (vote is null)
        {
            _votes.Remove((page, voter));
        }
        else
        {
            _votes[(page, voter)] = vote;
        }

        return Task.FromResult(Tally(page, voter));
    }

    public Task<VoteTally> GetAsync(string page, string voter, CancellationToken cancellationToken) =>
        Task.FromResult(Tally(page, voter));

    private VoteTally Tally(string page, string voter)
    {
        var up = _votes.Count(entry => entry.Key.Page == page && entry.Value == "up");
        var down = _votes.Count(entry => entry.Key.Page == page && entry.Value == "down");
        _votes.TryGetValue((page, voter), out var mine);

        return new VoteTally(up, down, mine);
    }
}
