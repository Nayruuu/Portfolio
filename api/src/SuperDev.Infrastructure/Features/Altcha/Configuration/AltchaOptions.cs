namespace SuperDev.Infrastructure.Features.Altcha;

public sealed record AltchaOptions
{
    public const string Section = "Altcha";

    public string HmacKey { get; init; } = "";

    public int MaxNumber { get; init; } = 50_000;

    public int ExpirySeconds { get; init; } = 300;
}
