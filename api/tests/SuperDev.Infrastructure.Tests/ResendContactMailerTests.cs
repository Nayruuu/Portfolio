using System.Net;
using System.Text.Json;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using SuperDev.Application.Models;
using SuperDev.Application.Exceptions;
using SuperDev.Application.Abstractions;

using SuperDev.Infrastructure.Extensions;
using SuperDev.Infrastructure.Tests.Fakes;

namespace SuperDev.Infrastructure.Tests;

public sealed class ResendContactMailerTests
{
    private static ContactMessage Message(string subject = "Mission") =>
        new("Jane", "jane@example.com", subject, "Bonjour");

    private static ServiceProvider BuildProvider(RecordingHttpHandler handler)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Contact:ResendApiKey"] = "re_test",
                ["Contact:From"] = "DoNotReply@super-dev.app",
                ["Contact:To"] = "contact@super-dev.app",
            })
            .Build();
        var services = new ServiceCollection()
            .AddLogging()
            .AddContact(configuration);
        services.ConfigureHttpClientDefaults(builder =>
            builder.ConfigurePrimaryHttpMessageHandler(() => handler));

        return services.BuildServiceProvider();
    }

    private static string? First(JsonElement element) =>
        element.ValueKind == JsonValueKind.Array ? element[0].GetString() : element.GetString();

    [Fact]
    public async Task The_mail_carries_sender_recipient_reply_to_and_the_prefixed_subject()
    {
        var handler = new RecordingHttpHandler(
            HttpStatusCode.OK, """{"id":"3f1f95c0-9b2a-4e6d-8d3a-2b1c6f7a9e10"}""");
        using var provider = BuildProvider(handler);
        using var scope = provider.CreateScope();

        await scope.ServiceProvider.GetRequiredService<IContactMailer>()
            .SendAsync(Message(), CancellationToken.None);

        Assert.Equal("Bearer re_test", handler.LastRequest?.Headers.Authorization?.ToString());
        using var body = JsonDocument.Parse(handler.LastRequestBody!);
        var root = body.RootElement;

        Assert.Equal("DoNotReply@super-dev.app", First(root.GetProperty("from")));
        Assert.Equal("contact@super-dev.app", First(root.GetProperty("to")));
        Assert.Equal("jane@example.com", First(root.GetProperty("reply_to")));
        Assert.Equal("[super-dev.app] Mission — Jane", root.GetProperty("subject").GetString());
        Assert.Contains("Bonjour", root.GetProperty("text").GetString());
    }

    [Fact]
    public async Task A_blank_subject_falls_back_to_the_contact_headline()
    {
        var handler = new RecordingHttpHandler(
            HttpStatusCode.OK, """{"id":"3f1f95c0-9b2a-4e6d-8d3a-2b1c6f7a9e10"}""");
        using var provider = BuildProvider(handler);
        using var scope = provider.CreateScope();

        await scope.ServiceProvider.GetRequiredService<IContactMailer>()
            .SendAsync(Message(subject: " "), CancellationToken.None);

        using var body = JsonDocument.Parse(handler.LastRequestBody!);

        Assert.Equal("[super-dev.app] Contact — Jane", body.RootElement.GetProperty("subject").GetString());
    }

    [Fact]
    public async Task A_provider_rejection_through_the_real_wiring_surfaces_as_a_contact_mail_exception()
    {
        var handler = new RecordingHttpHandler(
            HttpStatusCode.UnprocessableEntity, """{"statusCode":422,"message":"invalid from"}""");
        using var provider = BuildProvider(handler);
        using var scope = provider.CreateScope();
        var mailer = scope.ServiceProvider.GetRequiredService<IContactMailer>();

        await Assert.ThrowsAsync<ContactMailException>(
            () => mailer.SendAsync(Message(), CancellationToken.None));
    }
}
