using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
using System.Collections.Concurrent;

using Microsoft.Extensions.Options;

using SuperDev.Application.Features.Altcha;

namespace SuperDev.Infrastructure.Features.Altcha;

public sealed class AltchaVerifier : IAltcha
{
    private const string Algorithm = "SHA-256";
    private const string ExpiresParam = "?expires=";
    private const int PruneEvery = 256;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly ConcurrentDictionary<string, long> _used = new(StringComparer.Ordinal);
    private readonly AltchaOptions _options;
    private readonly TimeProvider _time;
    private readonly byte[] _key;

    private int _adds;

    public AltchaVerifier(IOptions<AltchaOptions> options, TimeProvider time)
    {
        _options = options.Value;
        _time = time;
        _key = Encoding.UTF8.GetBytes(_options.HmacKey);
    }

    public AltchaChallenge CreateChallenge()
    {
        var expires = _time.GetUtcNow().ToUnixTimeSeconds() + _options.ExpirySeconds;
        var salt = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(12)) + ExpiresParam + expires;
        var number = RandomNumberGenerator.GetInt32(_options.MaxNumber + 1);
        var challenge = Sha256Hex(salt + number);

        return new AltchaChallenge(Algorithm, challenge, _options.MaxNumber, salt, Sign(challenge));
    }

    public bool Verify(string? payload)
    {
        var solution = Decode(payload);

        if (solution is null
            || solution.Algorithm != Algorithm
            || solution.Challenge is null
            || solution.Salt is null)
        {
            return false;
        }
        if (Sha256Hex(solution.Salt + solution.Number) != solution.Challenge)
        {
            return false;
        }
        if (!FixedTimeEquals(Sign(solution.Challenge), solution.Signature))
        {
            return false;
        }
        if (Expired(solution.Salt, out var expires))
        {
            return false;
        }
        if (!_used.TryAdd(solution.Challenge, expires))
        {
            return false;
        }

        Prune();

        return true;
    }

    private string Sign(string challenge) =>
        Convert.ToHexStringLower(HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes(challenge)));

    private static string Sha256Hex(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static bool FixedTimeEquals(string expected, string? actual) =>
        actual is not null && CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(actual));

    private static AltchaSolution? Decode(string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<AltchaSolution>(
                Encoding.UTF8.GetString(Convert.FromBase64String(payload)), Json);
        }
        catch (Exception exception) when (exception is FormatException or JsonException)
        {
            return null;
        }
    }

    private bool Expired(string salt, out long expires)
    {
        expires = 0;
        var index = salt.IndexOf(ExpiresParam, StringComparison.Ordinal);

        if (index < 0 || !long.TryParse(salt.AsSpan(index + ExpiresParam.Length), out expires))
        {
            return true;
        }

        return _time.GetUtcNow().ToUnixTimeSeconds() >= expires;
    }

    private void Prune()
    {
        if (Interlocked.Increment(ref _adds) % PruneEvery != 0)
        {
            return;
        }

        var now = _time.GetUtcNow().ToUnixTimeSeconds();

        foreach (var (challenge, expiry) in _used)
        {
            if (expiry <= now)
            {
                _used.TryRemove(new KeyValuePair<string, long>(challenge, expiry));
            }
        }
    }
}
