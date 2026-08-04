using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using SuperDev.Infrastructure.Extensions;

namespace SuperDev.Infrastructure.Tests;

public sealed class ValidateOnStartTests
{
    [Fact]
    public void An_invalid_configuration_is_rejected_at_startup_not_at_first_request()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection([new KeyValuePair<string, string?>("Contact:RateLimitPerMinute", "0")])
            .Build();
        var provider = new ServiceCollection()
            .AddLogging()
            .AddContact(configuration)
            .BuildServiceProvider();

        var validator = provider.GetRequiredService<IStartupValidator>();

        Assert.Throws<OptionsValidationException>(validator.Validate);
    }
}
