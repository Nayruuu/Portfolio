using SuperDev.Application.Features.Contact;

namespace SuperDev.Api.Tests.Fakes;

public sealed class StubMailer : IContactMailer
{
    public List<ContactMessage> Sent { get; } = [];

    public Exception? Throw { get; init; }

    public Task SendAsync(ContactMessage message, CancellationToken cancellationToken)
    {
        if (Throw is not null)
        {
            throw Throw;
        }
        Sent.Add(message);

        return Task.CompletedTask;
    }
}
