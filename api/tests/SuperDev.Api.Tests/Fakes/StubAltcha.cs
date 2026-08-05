using SuperDev.Application.Features.Altcha;

namespace SuperDev.Api.Tests.Fakes;

public sealed class StubAltcha(bool verify = true) : IAltcha
{
    public AltchaChallenge Challenge { get; init; } =
        new("SHA-256", "abc123", 50_000, "deadbeef?expires=9999999999", "sig456");

    public AltchaChallenge CreateChallenge() => Challenge;

    public bool Verify(string? payload) => verify;
}
