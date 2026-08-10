namespace SuperDev.Application.Throttling;

public interface IRateLimiter
{
    public bool TryAcquire(string key);
}
