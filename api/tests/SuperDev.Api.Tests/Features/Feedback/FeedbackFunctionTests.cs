using System.Net;
using System.Text;

using SuperDev.Api.Tests.Fakes;
using SuperDev.Api.Http.Responses;
using SuperDev.Api.Features.Feedback;

using SuperDev.Application.Features.Feedback;

namespace SuperDev.Api.Tests.Features.Feedback;

public sealed class FeedbackFunctionTests
{
    private static FeedbackFunction Create(StubFeedbackSink sink) =>
        new(new FeedbackHandler(new InMemoryFeedbackStore(), sink));

    private static Task<ApiResult> Process(FeedbackFunction function, string body)
    {
        var stream = new MemoryStream(Encoding.UTF8.GetBytes(body));

        return function.ProcessAsync(stream, "voter", CancellationToken.None);
    }

    [Fact]
    public async Task A_valid_vote_maps_to_200_with_the_tally_and_is_recorded()
    {
        var sink = new StubFeedbackSink();

        var result = await Process(Create(sink), """{"vote":"up","page":"/fr"}""");

        Assert.Equal(HttpStatusCode.OK, result.Status);
        var tally = Assert.IsType<VoteTally>(result.Body);
        Assert.Equal(1, tally.Up);
        Assert.Equal("up", tally.Mine);
        Assert.Equal("up", Assert.Single(sink.Recorded).Vote);
    }

    [Fact]
    public async Task A_retraction_maps_to_200_and_logs_no_signal()
    {
        var sink = new StubFeedbackSink();

        var result = await Process(Create(sink), """{"vote":"","page":"/fr"}""");

        Assert.Equal(HttpStatusCode.OK, result.Status);
        Assert.Empty(sink.Recorded);
    }

    [Fact]
    public async Task Malformed_json_maps_to_400_and_records_nothing()
    {
        var sink = new StubFeedbackSink();

        var result = await Process(Create(sink), "not json");

        Assert.Equal(HttpStatusCode.BadRequest, result.Status);
        Assert.NotNull(result.Body);
        Assert.Empty(sink.Recorded);
    }

    [Fact]
    public async Task An_invalid_vote_maps_to_400()
    {
        var sink = new StubFeedbackSink();

        var result = await Process(Create(sink), """{"vote":"sideways","page":"/fr"}""");

        Assert.Equal(HttpStatusCode.BadRequest, result.Status);
        Assert.Empty(sink.Recorded);
    }

    [Fact]
    public async Task A_body_over_the_cap_maps_to_413_before_parsing()
    {
        var sink = new StubFeedbackSink();
        var big = $$"""{"vote":"up","page":"{{new string('x', 4096)}}"}""";

        var result = await Process(Create(sink), big);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, result.Status);
        Assert.Empty(sink.Recorded);
    }

    [Fact]
    public async Task ReadAsync_returns_the_tally_for_the_page_in_the_query()
    {
        var sink = new StubFeedbackSink();
        var function = Create(sink);
        await Process(function, """{"vote":"down","page":"/fr"}""");

        var result = await function.ReadAsync(
            new Uri("http://localhost/api/feedback?page=%2Ffr"), "voter", CancellationToken.None);

        Assert.Equal(HttpStatusCode.OK, result.Status);
        var tally = Assert.IsType<VoteTally>(result.Body);
        Assert.Equal(1, tally.Down);
        Assert.Equal("down", tally.Mine);
    }

    [Fact]
    public async Task Run_writes_a_200_body_for_a_valid_vote()
    {
        var request = new FakeHttpRequestData(
            new FakeFunctionContext(),
            new MemoryStream(Encoding.UTF8.GetBytes("""{"vote":"up","page":"/fr"}""")));

        var response = await Create(new StubFeedbackSink()).Run(request, CancellationToken.None);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Body.Length > 0);
    }

    [Fact]
    public async Task Run_handles_a_GET_as_a_read()
    {
        var request = new FakeHttpRequestData(new FakeFunctionContext(), Stream.Null, "GET");

        var response = await Create(new StubFeedbackSink()).Run(request, CancellationToken.None);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
