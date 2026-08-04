namespace SuperDev.Application.Models;

public abstract record ContactOutcome
{
    public sealed record Accepted : ContactOutcome
    {
        public static readonly Accepted Instance = new();
    }

    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : ContactOutcome;

    public sealed record DeliveryFailed : ContactOutcome
    {
        public static readonly DeliveryFailed Instance = new();
    }
}
