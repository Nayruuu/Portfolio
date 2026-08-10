using SuperDev.Application.Features.Altcha;

namespace SuperDev.Application.Features.Contact;

public sealed class ContactHandler(IContactMailer mailer, IAltcha altcha)
{
    public async Task<ContactOutcome> HandleAsync(
        ContactRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return new ContactOutcome.Invalid(
                new Dictionary<string, string[]> { ["body"] = ["a JSON body is required"] });
        }
        if (request.IsSpam)
        {
            return ContactOutcome.Accepted.Instance;
        }
        if (!request.TryParse(out var message, out var errors))
        {
            return new ContactOutcome.Invalid(errors);
        }
        if (!altcha.Verify(request.Altcha))
        {
            return ContactOutcome.Unverified.Instance;
        }

        try
        {
            await mailer.SendAsync(message, cancellationToken);
        }
        catch (ContactMailException)
        {
            return ContactOutcome.DeliveryFailed.Instance;
        }

        return ContactOutcome.Accepted.Instance;
    }
}
