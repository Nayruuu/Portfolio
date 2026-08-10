using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

namespace SuperDev.Api.Tests.Fakes;

public sealed class FakeHttpRequestDataFeature(HttpRequestData request) : IHttpRequestDataFeature
{
    public ValueTask<HttpRequestData?> GetHttpRequestDataAsync(FunctionContext context) => new(request);
}
