namespace SuperDev.Application.Features.Feedback;

public sealed class FeedbackHandler(IFeedbackStore store, IFeedbackSink sink)
{
    public async Task<FeedbackOutcome> HandleAsync(
        FeedbackRequest? request, string voter, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return new FeedbackOutcome.Invalid("a JSON body is required");
        }
        if (!request.TryParse(out var command, out var error))
        {
            return new FeedbackOutcome.Invalid(error);
        }

        var tally = await store.ApplyAsync(command.Page, voter, command.Vote, cancellationToken);

        if (command.Vote is not null)
        {
            sink.Record(new FeedbackSignal(command.Vote, command.Page));
        }

        return new FeedbackOutcome.Recorded(tally);
    }

    public Task<VoteTally> CountAsync(string? page, string voter, CancellationToken cancellationToken)
    {
        var trimmed = (page ?? "").Trim();

        return trimmed.Length is 0 or > FeedbackRequest.PageMax
            ? Task.FromResult(new VoteTally(0, 0, null))
            : store.GetAsync(trimmed, voter, cancellationToken);
    }
}
