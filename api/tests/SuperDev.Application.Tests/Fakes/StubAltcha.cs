using SuperDev.Application.Features.Altcha;

namespace SuperDev.Application.Tests.Fakes;

public sealed class StubAltcha(bool verify = true) : IAltcha
{
    public AltchaChallenge CreateChallenge() =>
        new("SHA-256", "challenge", 1000, "salt?expires=9999999999", "signature");

    public bool Verify(string? payload) => verify;
}
