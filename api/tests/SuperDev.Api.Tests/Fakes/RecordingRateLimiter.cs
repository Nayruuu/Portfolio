using SuperDev.Application.Throttling;

namespace SuperDev.Api.Tests.Fakes;

public sealed class RecordingRateLimiter(bool allow) : IRateLimiter
{
    public string? LastKey { get; private set; }

    public bool TryAcquire(string key)
    {
        LastKey = key;

        return allow;
    }
}
