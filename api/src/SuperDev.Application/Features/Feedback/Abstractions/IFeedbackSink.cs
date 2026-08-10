namespace SuperDev.Application.Features.Feedback;

public interface IFeedbackSink
{
    public void Record(FeedbackSignal signal);
}
