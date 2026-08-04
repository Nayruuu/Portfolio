using Resend;

using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using SuperDev.Application.Handlers;
using SuperDev.Application.Abstractions;

using SuperDev.Infrastructure.Mailers;
using SuperDev.Infrastructure.Throttling;
using SuperDev.Infrastructure.Configuration;

namespace SuperDev.Infrastructure.Extensions;

public static class ContactServiceCollectionExtensions
{
    public static IServiceCollection AddContact(
        this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection(ContactOptions.Section);

        services.AddOptions<ContactOptions>().Bind(section).ValidateOnStart();
        services.AddSingleton<IValidateOptions<ContactOptions>, ContactOptionsValidator>();

        services.AddResend(resendOptions =>
        {
            resendOptions.ApiToken = section[nameof(ContactOptions.ResendApiKey)] ?? "";
            resendOptions.ThrowExceptions = true;
        });
        services.AddScoped<IContactMailer, ResendContactMailer>();
        services.AddSingleton(Resolve<IRateLimiter>(o =>
            new FixedWindowRateLimiter(o.RateLimitPerMinute, TimeSpan.FromMinutes(1), TimeProvider.System)));
        services.AddScoped<ContactHandler>();

        return services;
    }

    private static Func<IServiceProvider, T> Resolve<T>(Func<ContactOptions, T> build) where T : class =>
        provider => build(provider.GetRequiredService<IOptions<ContactOptions>>().Value);
}
