using Microsoft.ApplicationInsights;
using Microsoft.ApplicationInsights.Channel;
using Microsoft.ApplicationInsights.DataContracts;
using Microsoft.ApplicationInsights.Extensibility;

using SuperDev.Application.Features.Feedback;
using SuperDev.Infrastructure.Features.Feedback;

namespace SuperDev.Infrastructure.Tests.Features.Feedback;

public sealed class TelemetryFeedbackSinkTests
{
    private sealed class CapturingChannel : ITelemetryChannel
    {
        public List<ITelemetry> Sent { get; } = [];

        public bool? DeveloperMode { get; set; }

        public string? EndpointAddress { get; set; }

        public void Send(ITelemetry item) => Sent.Add(item);

        public void Flush()
        {
        }

        public void Dispose()
        {
        }
    }

    [Fact]
    public void Record_tracks_a_named_feedback_event_carrying_the_vote_and_page()
    {
        var channel = new CapturingChannel();
        using var configuration = new TelemetryConfiguration
        {
            TelemetryChannel = channel,
            ConnectionString = "InstrumentationKey=00000000-0000-0000-0000-000000000000",
        };
        var sink = new TelemetryFeedbackSink(new TelemetryClient(configuration));

        sink.Record(new FeedbackSignal("up", "/fr"));

        var telemetry = Assert.IsType<EventTelemetry>(Assert.Single(channel.Sent));
        Assert.Equal("Feedback", telemetry.Name);
        Assert.Equal("up", telemetry.Properties["vote"]);
        Assert.Equal("/fr", telemetry.Properties["page"]);
    }
}
