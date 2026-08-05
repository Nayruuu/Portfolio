using System.Collections;

using Microsoft.Azure.Functions.Worker;

namespace SuperDev.Api.Tests.Fakes;

public sealed class FakeInvocationFeatures : IInvocationFeatures
{
    private readonly Dictionary<Type, object> _features = [];

    public void Set<T>(T instance)
    {
        if (instance is not null)
        {
            _features[typeof(T)] = instance;
        }
    }

    public T Get<T>() => _features.TryGetValue(typeof(T), out var instance) ? (T)instance : default!;

    public IEnumerator<KeyValuePair<Type, object>> GetEnumerator() => _features.GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}
