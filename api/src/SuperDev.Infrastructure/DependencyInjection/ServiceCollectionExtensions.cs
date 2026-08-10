using Resend;

using Azure.Data.Tables;

using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using SuperDev.Application.Throttling;
using SuperDev.Application.Features.Altcha;
using SuperDev.Application.Features.Contact;
using SuperDev.Application.Features.Feedback;

using SuperDev.Infrastructure.Throttling;
using SuperDev.Infrastructure.Features.Altcha;
using SuperDev.Infrastructure.Features.Contact;
using SuperDev.Infrastructure.Features.Feedback;

namespace SuperDev.Infrastructure.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddSuperDevApi(
        this IServiceCollection services, IConfiguration configuration)
    {
        var contactSection = configuration.GetSection(ContactOptions.Section);

        services.AddOptions<ContactOptions>().Bind(contactSection).ValidateOnStart();
        services.AddSingleton<IValidateOptions<ContactOptions>, ContactOptionsValidator>();

        services.AddOptions<FeedbackOptions>()
            .Bind(configuration.GetSection(FeedbackOptions.Section)).ValidateOnStart();
        services.AddSingleton<IValidateOptions<FeedbackOptions>, FeedbackOptionsValidator>();

        services.AddOptions<AltchaOptions>()
            .Bind(configuration.GetSection(AltchaOptions.Section)).ValidateOnStart();
        services.AddSingleton<IValidateOptions<AltchaOptions>, AltchaOptionsValidator>();
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<IAltcha, AltchaVerifier>();

        services.AddResend(resendOptions =>
        {
            resendOptions.ApiToken = contactSection[nameof(ContactOptions.ResendApiKey)] ?? "";
            resendOptions.ThrowExceptions = true;
        });
        services.AddScoped<IContactMailer, ResendContactMailer>();
        services.AddScoped<ContactHandler>();

        services.AddSingleton<IFeedbackSink, TelemetryFeedbackSink>();
        services.AddSingleton(new TableServiceClient(
            configuration["AzureWebJobsStorage"] ?? "UseDevelopmentStorage=true"));
        services.AddSingleton<IFeedbackStore, TableFeedbackStore>();
        services.AddScoped<FeedbackHandler>();

        // One bucket per route, keyed by the trigger's last path segment (see RateLimitingMiddleware).
        services.AddSingleton<IRateLimitPolicy>(provider => new RouteRateLimitPolicy(
            new Dictionary<string, IRateLimiter>(StringComparer.OrdinalIgnoreCase)
            {
                ["contact"] = Window(provider.GetRequiredService<IOptions<ContactOptions>>().Value.RateLimitPerMinute),
                ["feedback"] = Window(provider.GetRequiredService<IOptions<FeedbackOptions>>().Value.RateLimitPerMinute),
            }));

        return services;
    }

    private static FixedWindowRateLimiter Window(int permitsPerMinute) =>
        new(permitsPerMinute, TimeSpan.FromMinutes(1), TimeProvider.System);
}
