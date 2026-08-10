namespace SuperDev.Application.Throttling;

public interface IRateLimitPolicy
{
    // null when the route has no configured bucket (so it is never throttled).
    public IRateLimiter? LimiterFor(string route);
}
