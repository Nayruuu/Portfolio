using SuperDev.Application.Throttling;
using SuperDev.Infrastructure.Throttling;

namespace SuperDev.Infrastructure.Tests.Throttling;

public sealed class RouteRateLimitPolicyTests
{
    private static readonly IRateLimiter Contact = new StubLimiter();
    private static readonly IRateLimiter Feedback = new StubLimiter();

    private static RouteRateLimitPolicy Policy() => new(
        new Dictionary<string, IRateLimiter>(StringComparer.OrdinalIgnoreCase)
        {
            ["contact"] = Contact,
            ["feedback"] = Feedback,
        });

    [Fact]
    public void Each_route_resolves_to_its_own_limiter()
    {
        var policy = Policy();

        Assert.Same(Contact, policy.LimiterFor("contact"));
        Assert.Same(Feedback, policy.LimiterFor("feedback"));
    }

    [Fact]
    public void Route_matching_honours_the_dictionary_comparer()
    {
        Assert.Same(Feedback, Policy().LimiterFor("Feedback"));
    }

    [Fact]
    public void An_unmapped_route_has_no_limiter()
    {
        Assert.Null(Policy().LimiterFor("altcha"));
    }

    private sealed class StubLimiter : IRateLimiter
    {
        public bool TryAcquire(string key) => true;
    }
}
