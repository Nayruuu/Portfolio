using System.Text;
using System.Text.Json;
using System.Security.Cryptography;

using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;

using SuperDev.Application.Features.Altcha;

using SuperDev.Infrastructure.Features.Altcha;

namespace SuperDev.Infrastructure.Tests.Features.Altcha;

public sealed class AltchaTests
{
    private static AltchaVerifier Create(FakeTimeProvider clock, out AltchaOptions options)
    {
        options = new AltchaOptions { HmacKey = "test-key", MaxNumber = 200, ExpirySeconds = 300 };

        return new AltchaVerifier(Options.Create(options), clock);
    }

    private static string Sha256Hex(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static int FindNumber(AltchaChallenge challenge)
    {
        for (var number = 0; number <= challenge.Maxnumber; number++)
        {
            if (Sha256Hex(challenge.Salt + number) == challenge.Challenge)
            {
                return number;
            }
        }

        throw new InvalidOperationException("challenge is unsolvable within maxnumber");
    }

    private static string Build(AltchaChallenge challenge, int number)
    {
        var json = JsonSerializer.Serialize(new
        {
            algorithm = challenge.Algorithm,
            challenge = challenge.Challenge,
            number,
            salt = challenge.Salt,
            signature = challenge.Signature,
        });

        return Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
    }

    private static string Solve(AltchaChallenge challenge) => Build(challenge, FindNumber(challenge));

    [Fact]
    public void A_created_challenge_has_the_sha256_shape_and_an_expiry()
    {
        var challenge = Create(new FakeTimeProvider(), out var options).CreateChallenge();

        Assert.Equal("SHA-256", challenge.Algorithm);
        Assert.Equal(options.MaxNumber, challenge.Maxnumber);
        Assert.Contains("?expires=", challenge.Salt, StringComparison.Ordinal);
        Assert.Equal(64, challenge.Challenge.Length);
        Assert.Equal(64, challenge.Signature.Length);
    }

    [Fact]
    public void A_correctly_solved_challenge_verifies()
    {
        var altcha = Create(new FakeTimeProvider(), out _);

        Assert.True(altcha.Verify(Solve(altcha.CreateChallenge())));
    }

    [Fact]
    public void A_null_or_garbage_payload_is_rejected()
    {
        var altcha = Create(new FakeTimeProvider(), out _);

        Assert.False(altcha.Verify(null));
        Assert.False(altcha.Verify("   "));
        Assert.False(altcha.Verify("not-base64-@@@"));
        Assert.False(altcha.Verify(Convert.ToBase64String(Encoding.UTF8.GetBytes("{}"))));
    }

    [Fact]
    public void A_wrong_number_is_rejected()
    {
        var altcha = Create(new FakeTimeProvider(), out _);
        var challenge = altcha.CreateChallenge();
        var real = FindNumber(challenge);

        Assert.False(altcha.Verify(Build(challenge, real == 0 ? 1 : 0)));
    }

    [Fact]
    public void A_challenge_signed_by_a_different_key_is_rejected()
    {
        var clock = new FakeTimeProvider();
        var attacker = new AltchaVerifier(
            Options.Create(new AltchaOptions { HmacKey = "other-key", MaxNumber = 200 }), clock);
        var server = Create(clock, out _);

        Assert.False(server.Verify(Solve(attacker.CreateChallenge())));
    }

    [Fact]
    public void An_expired_challenge_is_rejected()
    {
        var clock = new FakeTimeProvider();
        var altcha = Create(clock, out var options);
        var solution = Solve(altcha.CreateChallenge());

        clock.Advance(TimeSpan.FromSeconds(options.ExpirySeconds + 1));

        Assert.False(altcha.Verify(solution));
    }

    [Fact]
    public void A_replayed_solution_is_rejected()
    {
        var altcha = Create(new FakeTimeProvider(), out _);
        var solution = Solve(altcha.CreateChallenge());

        Assert.True(altcha.Verify(solution));
        Assert.False(altcha.Verify(solution));
    }
}
