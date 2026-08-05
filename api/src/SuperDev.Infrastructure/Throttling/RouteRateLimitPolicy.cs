using SuperDev.Application.Throttling;

namespace SuperDev.Infrastructure.Throttling;

public sealed class RouteRateLimitPolicy(IReadOnlyDictionary<string, IRateLimiter> byRoute)
    : IRateLimitPolicy
{
    public IRateLimiter? LimiterFor(string route) => byRoute.GetValueOrDefault(route);
}
