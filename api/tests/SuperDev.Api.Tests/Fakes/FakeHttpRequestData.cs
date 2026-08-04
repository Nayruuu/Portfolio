using System.Security.Claims;

using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

namespace SuperDev.Api.Tests.Fakes;

public sealed class FakeHttpRequestData(FunctionContext context, Stream body) : HttpRequestData(context)
{
    public override Stream Body { get; } = body;

    public override HttpHeadersCollection Headers { get; } = [];

    public override IReadOnlyCollection<IHttpCookie> Cookies => throw new NotSupportedException();

    public override Uri Url => new("http://localhost/api/contact");

    public override IEnumerable<ClaimsIdentity> Identities => [];

    public override string Method => "POST";

    public override HttpResponseData CreateResponse() => new FakeHttpResponseData(FunctionContext);
}
