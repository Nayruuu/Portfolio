using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using SuperDev.Infrastructure.DependencyInjection;

namespace SuperDev.Infrastructure.Tests.DependencyInjection;

public sealed class ValidateOnStartTests
{
    [Fact]
    public void An_invalid_configuration_is_rejected_at_startup_not_at_first_request()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Contact:RateLimitPerMinute"] = "0",
                ["Altcha:HmacKey"] = "test-key",
            })
            .Build();
        var provider = new ServiceCollection()
            .AddLogging()
            .AddSuperDevApi(configuration)
            .BuildServiceProvider();

        var validator = provider.GetRequiredService<IStartupValidator>();

        Assert.Throws<OptionsValidationException>(validator.Validate);
    }
}
