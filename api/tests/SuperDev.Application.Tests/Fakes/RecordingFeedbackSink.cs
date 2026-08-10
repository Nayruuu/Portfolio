using SuperDev.Application.Features.Feedback;

namespace SuperDev.Application.Tests.Fakes;

public sealed class RecordingFeedbackSink : IFeedbackSink
{
    public List<FeedbackSignal> Recorded { get; } = [];

    public void Record(FeedbackSignal signal) => Recorded.Add(signal);
}
