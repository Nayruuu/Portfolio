namespace SuperDev.Infrastructure.Features.Contact;

public sealed record ContactOptions
{
    public const string Section = "Contact";

    public string ResendApiKey { get; init; } = "";

    public string From { get; init; } = "";

    public string To { get; init; } = "";

    public string SubjectPrefix { get; init; } = "[super-dev.app]";

    public int RateLimitPerMinute { get; init; } = 5;

    public int MaxRequestBytes { get; init; } = 32 * 1024;
}
