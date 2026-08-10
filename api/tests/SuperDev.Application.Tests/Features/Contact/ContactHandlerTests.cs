using SuperDev.Application.Tests.Fakes;
using SuperDev.Application.Features.Contact;

namespace SuperDev.Application.Tests.Features.Contact;

public sealed class ContactHandlerTests
{
    private static ContactRequest Valid() =>
        new("Jane Doe", "jane@example.com", "Une mission", "Bonjour, parlons de votre profil.", "", "solved");

    private static (ContactHandler Handler, RecordingMailer Mailer) CreateHandler(bool verify = true)
    {
        var mailer = new RecordingMailer();

        return (new ContactHandler(mailer, new StubAltcha(verify)), mailer);
    }

    [Fact]
    public async Task A_display_name_email_is_normalized_to_the_bare_mailbox()
    {
        var request = Valid() with { Email = "Payroll <ceo@example.com>" };
        var (handler, mailer) = CreateHandler();

        await handler.HandleAsync(request, CancellationToken.None);

        Assert.Equal("ceo@example.com", Assert.Single(mailer.Sent).Email);
    }

    [Fact]
    public async Task Valid_request_is_accepted_and_mailed_once()
    {
        var (handler, mailer) = CreateHandler();

        var outcome = await handler.HandleAsync(Valid(), CancellationToken.None);

        Assert.IsType<ContactOutcome.Accepted>(outcome);
        var sent = Assert.Single(mailer.Sent);
        Assert.Equal("Jane Doe", sent.Name);
        Assert.Equal("jane@example.com", sent.Email);
        Assert.Equal("Une mission", sent.Subject);
        Assert.Equal("Bonjour, parlons de votre profil.", sent.Message);
    }

    [Theory]
    [InlineData("", "jane@example.com", "s", "hello")]
    [InlineData("Jane", "", "s", "hello")]
    [InlineData("Jane", "jane@example.com", "s", "")]
    [InlineData("Jane", "not-an-email", "s", "hello")]
    [InlineData("Jane", "jane@", "s", "hello")]
    [InlineData("\u0001\u0002", "jane@example.com", "s", "hello")]
    public async Task Invalid_fields_are_rejected_and_nothing_is_mailed(
        string name, string email, string subject, string message)
    {
        var (handler, mailer) = CreateHandler();

        var outcome = await handler.HandleAsync(
            new ContactRequest(name, email, subject, message, "", "solved"), CancellationToken.None);

        Assert.IsType<ContactOutcome.Invalid>(outcome);
        Assert.Empty(mailer.Sent);
    }

    [Fact]
    public async Task A_failed_altcha_verification_is_rejected_and_nothing_is_mailed()
    {
        var (handler, mailer) = CreateHandler(verify: false);

        var outcome = await handler.HandleAsync(Valid(), CancellationToken.None);

        Assert.IsType<ContactOutcome.Unverified>(outcome);
        Assert.Empty(mailer.Sent);
    }

    [Fact]
    public async Task Oversized_message_is_rejected()
    {
        var (handler, mailer) = CreateHandler();
        var request = Valid() with { Message = new string('x', 4001) };

        var outcome = await handler.HandleAsync(request, CancellationToken.None);

        Assert.IsType<ContactOutcome.Invalid>(outcome);
        Assert.Empty(mailer.Sent);
    }

    [Fact]
    public async Task Missing_body_is_rejected()
    {
        var (handler, mailer) = CreateHandler();

        var outcome = await handler.HandleAsync(null, CancellationToken.None);

        Assert.IsType<ContactOutcome.Invalid>(outcome);
        Assert.Empty(mailer.Sent);
    }

    [Fact]
    public async Task Filled_honeypot_pretends_success_but_mails_nothing()
    {
        var (handler, mailer) = CreateHandler();
        var request = Valid() with { Website = "https://spam.example" };

        var outcome = await handler.HandleAsync(request, CancellationToken.None);

        Assert.IsType<ContactOutcome.Accepted>(outcome);
        Assert.Empty(mailer.Sent);
    }

    [Fact]
    public async Task Control_characters_are_stripped_from_the_name_and_subject()
    {
        var request = Valid() with { Name = "Jane\r\nBcc: x@y", Subject = "Une\tmission\r\n" };
        var (handler, mailer) = CreateHandler();

        await handler.HandleAsync(request, CancellationToken.None);

        var sent = Assert.Single(mailer.Sent);
        Assert.Equal("JaneBcc: x@y", sent.Name);
        Assert.Equal("Unemission", sent.Subject);
    }

    [Fact]
    public async Task Mailer_failure_is_reported_as_delivery_failed()
    {
        var (handler, mailer) = CreateHandler();
        mailer.FailNext = true;

        var outcome = await handler.HandleAsync(Valid(), CancellationToken.None);

        Assert.IsType<ContactOutcome.DeliveryFailed>(outcome);
    }
}
