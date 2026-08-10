using Microsoft.Extensions.Time.Testing;

using SuperDev.Infrastructure.Throttling;

namespace SuperDev.Infrastructure.Tests.Throttling;

public sealed class FixedWindowRateLimiterTests
{
    [Fact]
    public void Permits_are_per_key_and_replenish_when_the_window_rolls()
    {
        var clock = new FakeTimeProvider();
        var limiter = new FixedWindowRateLimiter(2, TimeSpan.FromMinutes(1), clock);

        Assert.True(limiter.TryAcquire("a"));
        Assert.True(limiter.TryAcquire("a"));
        Assert.False(limiter.TryAcquire("a"));
        Assert.True(limiter.TryAcquire("b"));

        clock.Advance(TimeSpan.FromMinutes(1));
        Assert.True(limiter.TryAcquire("a"));
    }

    [Fact]
    public void Under_parallel_contention_exactly_the_permitted_count_is_allowed()
    {
        const int permits = 50;
        const int callers = 500;
        var limiter = new FixedWindowRateLimiter(permits, TimeSpan.FromMinutes(1), TimeProvider.System);
        var allowed = 0;

        Parallel.For(0, callers, _ =>
        {
            if (limiter.TryAcquire("same-key"))
            {
                Interlocked.Increment(ref allowed);
            }
        });

        Assert.Equal(permits, allowed);
    }

    [Fact]
    public void Expired_keys_are_pruned_from_the_dictionary()
    {
        var clock = new FakeTimeProvider();
        var limiter = new FixedWindowRateLimiter(1, TimeSpan.FromMinutes(1), clock);

        limiter.TryAcquire("stale");
        clock.Advance(TimeSpan.FromMinutes(2));

        for (var i = 0; i < 256; i++)
        {
            limiter.TryAcquire($"fresh-{i}");
        }

        Assert.Equal(256, limiter.TrackedKeys);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void A_non_positive_permit_count_is_rejected(int permits)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new FixedWindowRateLimiter(permits, TimeSpan.FromMinutes(1), TimeProvider.System));
    }

    [Fact]
    public void A_zero_window_is_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new FixedWindowRateLimiter(1, TimeSpan.Zero, TimeProvider.System));
    }

    [Fact]
    public void Distinct_keys_each_get_their_own_permits_in_parallel()
    {
        var limiter = new FixedWindowRateLimiter(1, TimeSpan.FromMinutes(1), TimeProvider.System);
        var allowed = 0;

        Parallel.For(0, 200, i =>
        {
            if (limiter.TryAcquire($"key-{i}"))
            {
                Interlocked.Increment(ref allowed);
            }
        });

        Assert.Equal(200, allowed);
    }
}
