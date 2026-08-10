using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using SuperDev.Infrastructure.Features.Contact;
using SuperDev.Infrastructure.DependencyInjection;

using SuperDev.Application.Features.Contact;

namespace SuperDev.Infrastructure.Tests.DependencyInjection;

public sealed class ServiceCollectionExtensionsTests
{
    [Fact]
    public void The_resend_mailer_is_wired_as_the_contact_mailer()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Contact:ResendApiKey"] = "re_test",
                ["Contact:From"] = "DoNotReply@super-dev.app",
                ["Contact:To"] = "inbox@super-dev.app",
            })
            .Build();
        using var provider = new ServiceCollection()
            .AddLogging()
            .AddSuperDevApi(configuration)
            .BuildServiceProvider();

        Assert.IsType<ResendContactMailer>(provider.GetRequiredService<IContactMailer>());
    }
}
