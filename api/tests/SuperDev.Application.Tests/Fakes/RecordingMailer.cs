using SuperDev.Application.Features.Contact;

namespace SuperDev.Application.Tests.Fakes;

public sealed class RecordingMailer : IContactMailer
{
    public List<ContactMessage> Sent { get; } = [];

    public bool FailNext { get; set; }

    public Task SendAsync(ContactMessage message, CancellationToken cancellationToken)
    {
        if (FailNext)
        {
            FailNext = false;
            throw new ContactMailException("simulated provider outage");
        }
        Sent.Add(message);

        return Task.CompletedTask;
    }
}
