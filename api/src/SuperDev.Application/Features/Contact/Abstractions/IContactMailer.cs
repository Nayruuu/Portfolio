namespace SuperDev.Application.Features.Contact;

public interface IContactMailer
{
    public Task SendAsync(ContactMessage message, CancellationToken cancellationToken);
}
