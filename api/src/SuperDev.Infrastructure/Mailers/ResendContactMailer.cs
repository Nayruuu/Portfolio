using Resend;

using Microsoft.Extensions.Options;

using SuperDev.Application.Models;
using SuperDev.Application.Exceptions;
using SuperDev.Application.Abstractions;

using SuperDev.Infrastructure.Configuration;

namespace SuperDev.Infrastructure.Mailers;

public sealed class ResendContactMailer(IResend resend, IOptions<ContactOptions> options)
    : IContactMailer
{
    private readonly ContactOptions _options = options.Value;

    public async Task SendAsync(ContactMessage message, CancellationToken cancellationToken)
    {
        var subject = string.IsNullOrWhiteSpace(message.Subject)
            ? $"{_options.SubjectPrefix} Contact — {message.Name}"
            : $"{_options.SubjectPrefix} {message.Subject} — {message.Name}";
        var mail = new EmailMessage
        {
            From = _options.From,
            To = { _options.To },
            ReplyTo = [message.Email],
            Subject = subject,
            TextBody = $"From: {message.Name} <{message.Email}>\n\n{message.Message}",
        };

        try
        {
            await resend.EmailSendAsync(mail, cancellationToken);
        }
        catch (ResendException exception)
        {
            throw new ContactMailException("the mail provider rejected the send", exception);
        }
    }
}
