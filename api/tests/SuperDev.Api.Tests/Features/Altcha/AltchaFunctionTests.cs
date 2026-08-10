using System.Net;
using System.Text;

using SuperDev.Api.Tests.Fakes;
using SuperDev.Api.Features.Altcha;

namespace SuperDev.Api.Tests.Features.Altcha;

public sealed class AltchaFunctionTests
{
    [Fact]
    public async Task It_returns_a_fresh_challenge_as_json()
    {
        var context = new FakeFunctionContext();
        var request = new FakeHttpRequestData(context, Stream.Null);

        var response = await new AltchaFunction(new StubAltcha()).Run(request, CancellationToken.None);
        response.Body.Position = 0;
        var body = await new StreamReader(response.Body, Encoding.UTF8).ReadToEndAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"algorithm\":\"SHA-256\"", body, StringComparison.Ordinal);
        Assert.Contains("abc123", body, StringComparison.Ordinal);
    }
}
