namespace SuperDev.Infrastructure.Features.Altcha;

internal sealed record AltchaSolution(
    string? Algorithm,
    string? Challenge,
    int Number,
    string? Salt,
    string? Signature);
