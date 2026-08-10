using SuperDev.Application.Features.Feedback;

namespace SuperDev.Api.Tests.Fakes;

public sealed class StubFeedbackSink : IFeedbackSink
{
    public List<FeedbackSignal> Recorded { get; } = [];

    public void Record(FeedbackSignal signal) => Recorded.Add(signal);
}
