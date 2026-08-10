using System.Text.Json;

using Azure.Core.Serialization;

using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.DependencyInjection;

namespace SuperDev.Api.Tests.Fakes;

public sealed class FakeFunctionContext : FunctionContext
{
    public override IServiceProvider InstanceServices { get; set; } = BuildServices();

    public override string InvocationId => "test";

    public override string FunctionId => "test";

    public override IDictionary<object, object> Items { get; set; } = new Dictionary<object, object>();

    public override IInvocationFeatures Features { get; } = new FakeInvocationFeatures();

    public override TraceContext TraceContext => throw new NotSupportedException();

    public override BindingContext BindingContext => throw new NotSupportedException();

    public override RetryContext RetryContext => throw new NotSupportedException();

    public override FunctionDefinition FunctionDefinition => throw new NotSupportedException();

    public void SetHttpRequest(HttpRequestData request) =>
        Features.Set<IHttpRequestDataFeature>(new FakeHttpRequestDataFeature(request));

    private static ServiceProvider BuildServices() =>
        new ServiceCollection()
            .Configure<WorkerOptions>(options => options.Serializer =
                new JsonObjectSerializer(new JsonSerializerOptions(JsonSerializerDefaults.Web)))
            .BuildServiceProvider();
}
