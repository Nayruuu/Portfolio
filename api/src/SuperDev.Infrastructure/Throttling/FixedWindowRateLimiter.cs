using System.Collections.Concurrent;

using SuperDev.Application.Abstractions;

namespace SuperDev.Infrastructure.Throttling;

public sealed class FixedWindowRateLimiter : IRateLimiter
{
    private const int PruneEvery = 256;

    private readonly ConcurrentDictionary<string, (long WindowStart, int Count)> _windows = new();
    private readonly int _permitsPerWindow;
    private readonly TimeSpan _window;
    private readonly TimeProvider _time;
    private int _acquiresSincePrune;

    public FixedWindowRateLimiter(int permitsPerWindow, TimeSpan window, TimeProvider time)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(permitsPerWindow);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(window.Ticks);
        ArgumentNullException.ThrowIfNull(time);

        _permitsPerWindow = permitsPerWindow;
        _window = window;
        _time = time;
    }

    internal int TrackedKeys => _windows.Count;

    public bool TryAcquire(string key)
    {
        var now = _time.GetUtcNow().Ticks;

        if (Interlocked.Increment(ref _acquiresSincePrune) % PruneEvery == 0)
        {
            PruneExpired(now);
        }
        var updated = _windows.AddOrUpdate(
            key,
            _ => (now, 1),
            (_, current) => now - current.WindowStart >= _window.Ticks
                ? (now, 1)
                : (current.WindowStart, current.Count + 1));

        return updated.Count <= _permitsPerWindow;
    }

    private void PruneExpired(long now)
    {
        foreach (var (key, value) in _windows)
        {
            if (now - value.WindowStart >= _window.Ticks)
            {
                _windows.TryRemove(KeyValuePair.Create(key, value));
            }
        }
    }
}
