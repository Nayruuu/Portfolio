using SuperDev.Application.Throttling;

namespace SuperDev.Api.Tests.Fakes;

public sealed class StubRateLimiter(bool allow) : IRateLimiter
{
    public bool TryAcquire(string key) => allow;
}
