using SuperDev.Application.Models;

namespace SuperDev.Application.Abstractions;

public interface IContactMailer
{
    public Task SendAsync(ContactMessage message, CancellationToken cancellationToken);
}
