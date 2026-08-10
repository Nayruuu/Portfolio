using SuperDev.Application.Tests.Fakes;
using SuperDev.Application.Features.Feedback;

namespace SuperDev.Application.Tests.Features.Feedback;

public sealed class FeedbackHandlerTests
{
    private static (FeedbackHandler Handler, RecordingFeedbackSink Sink) Create()
    {
        var sink = new RecordingFeedbackSink();

        return (new FeedbackHandler(new InMemoryFeedbackStore(), sink), sink);
    }

    private static VoteTally Tally(FeedbackOutcome outcome) =>
        Assert.IsType<FeedbackOutcome.Recorded>(outcome).Tally;

    [Theory]
    [InlineData("up", "up")]
    [InlineData("down", "down")]
    [InlineData("UP", "up")]
    [InlineData(" Down ", "down")]
    public async Task A_valid_vote_is_canonicalized_recorded_and_reflected_in_the_tally(
        string input, string canonical)
    {
        var (handler, sink) = Create();

        var outcome = await handler.HandleAsync(new FeedbackRequest(input, "/fr"), "voter", default);

        var tally = Tally(outcome);
        Assert.Equal(canonical, tally.Mine);
        Assert.Equal(canonical == "up" ? 1 : 0, tally.Up);
        Assert.Equal(canonical == "down" ? 1 : 0, tally.Down);
        Assert.Equal(canonical, Assert.Single(sink.Recorded).Vote);
    }

    [Fact]
    public async Task Re_voting_the_other_way_moves_the_count_not_adds_to_it()
    {
        var (handler, _) = Create();

        await handler.HandleAsync(new FeedbackRequest("up", "/fr"), "voter", default);
        var tally = Tally(await handler.HandleAsync(new FeedbackRequest("down", "/fr"), "voter", default));

        Assert.Equal(0, tally.Up);
        Assert.Equal(1, tally.Down);
        Assert.Equal("down", tally.Mine);
    }

    [Fact]
    public async Task An_empty_vote_retracts_without_logging_a_signal()
    {
        var (handler, sink) = Create();

        await handler.HandleAsync(new FeedbackRequest("up", "/fr"), "voter", default);
        var tally = Tally(await handler.HandleAsync(new FeedbackRequest("", "/fr"), "voter", default));

        Assert.Equal(0, tally.Up);
        Assert.Null(tally.Mine);
        Assert.Single(sink.Recorded); // only the "up" was logged, not the retraction
    }

    [Fact]
    public async Task Distinct_voters_each_add_to_the_page_count()
    {
        var (handler, _) = Create();

        await handler.HandleAsync(new FeedbackRequest("up", "/fr"), "alice", default);
        var tally = Tally(await handler.HandleAsync(new FeedbackRequest("up", "/fr"), "bob", default));

        Assert.Equal(2, tally.Up);
    }

    [Theory]
    [InlineData("sideways")]
    [InlineData("1")]
    public async Task An_invalid_vote_is_rejected_and_nothing_is_recorded(string vote)
    {
        var (handler, sink) = Create();

        var outcome = await handler.HandleAsync(new FeedbackRequest(vote, "/fr"), "voter", default);

        Assert.IsType<FeedbackOutcome.Invalid>(outcome);
        Assert.Empty(sink.Recorded);
    }

    [Fact]
    public async Task A_missing_body_is_rejected()
    {
        var (handler, sink) = Create();

        Assert.IsType<FeedbackOutcome.Invalid>(await handler.HandleAsync(null, "voter", default));
        Assert.Empty(sink.Recorded);
    }

    [Theory]
    [InlineData("")]
    [InlineData("\r\n\t")]
    public async Task A_missing_page_is_rejected(string page)
    {
        var (handler, _) = Create();

        Assert.IsType<FeedbackOutcome.Invalid>(
            await handler.HandleAsync(new FeedbackRequest("up", page), "voter", default));
    }

    [Fact]
    public async Task An_oversized_page_is_rejected()
    {
        var (handler, _) = Create();

        Assert.IsType<FeedbackOutcome.Invalid>(
            await handler.HandleAsync(new FeedbackRequest("up", new string('x', 301)), "voter", default));
    }

    [Fact]
    public async Task Control_characters_are_stripped_from_the_page()
    {
        var (handler, sink) = Create();

        await handler.HandleAsync(new FeedbackRequest("up", "/fr\r\n\t"), "voter", default);

        Assert.Equal("/fr", Assert.Single(sink.Recorded).Page);
    }

    [Fact]
    public async Task CountAsync_reads_the_tally_and_the_caller_s_own_vote()
    {
        var (handler, _) = Create();
        await handler.HandleAsync(new FeedbackRequest("up", "/fr"), "alice", default);
        await handler.HandleAsync(new FeedbackRequest("down", "/fr"), "bob", default);

        var tally = await handler.CountAsync("/fr", "alice", default);

        Assert.Equal(1, tally.Up);
        Assert.Equal(1, tally.Down);
        Assert.Equal("up", tally.Mine);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CountAsync_returns_an_empty_tally_for_a_blank_page(string page)
    {
        var (handler, _) = Create();

        var tally = await handler.CountAsync(page, "voter", default);

        Assert.Equal(new VoteTally(0, 0, null), tally);
    }
}
