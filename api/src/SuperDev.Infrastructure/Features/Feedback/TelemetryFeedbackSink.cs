using Microsoft.ApplicationInsights;

using SuperDev.Application.Features.Feedback;

namespace SuperDev.Infrastructure.Features.Feedback;

/// <summary>
/// Records a thumbs vote as an App Insights custom event — queryable in `customEvents`,
/// and (unlike an ILogger trace) not dropped by the isolated worker's Warning-level filter.
/// </summary>
public sealed class TelemetryFeedbackSink(TelemetryClient telemetry) : IFeedbackSink
{
    public void Record(FeedbackSignal signal) =>
        telemetry.TrackEvent(
            "Feedback",
            new Dictionary<string, string> { ["vote"] = signal.Vote, ["page"] = signal.Page });
}
