using SuperDev.Application.Throttling;

namespace SuperDev.Api.Tests.Fakes;

public sealed class StubRateLimitPolicy(IRateLimiter? limiter) : IRateLimitPolicy
{
    public IRateLimiter? LimiterFor(string route) => limiter;
}
