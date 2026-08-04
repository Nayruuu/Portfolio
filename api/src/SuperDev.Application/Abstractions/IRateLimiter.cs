namespace SuperDev.Application.Abstractions;

public interface IRateLimiter
{
    public bool TryAcquire(string key);
}
