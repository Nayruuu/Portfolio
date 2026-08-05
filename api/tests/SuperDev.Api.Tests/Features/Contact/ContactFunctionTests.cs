using System.Net;
using System.Text;

using Microsoft.Extensions.Options;

using SuperDev.Api.Tests.Fakes;
using SuperDev.Api.Http.Responses;
using SuperDev.Api.Features.Contact;

using SuperDev.Application.Features.Contact;

using SuperDev.Infrastructure.Features.Contact;

namespace SuperDev.Api.Tests.Features.Contact;

public sealed class ContactFunctionTests
{
    private const string ValidBody =
        """{"name":"Jane","email":"jane@example.com","subject":"Mission","message":"Bonjour"}""";

    private static ContactFunction Create(StubMailer mailer, int maxRequestBytes = 32 * 1024)
    {
        var handler = new ContactHandler(mailer, new StubAltcha());
        var options = Options.Create(new ContactOptions { MaxRequestBytes = maxRequestBytes });

        return new ContactFunction(handler, options);
    }

    private static Task<ApiResult> Process(ContactFunction function, string body)
    {
        var stream = new MemoryStream(Encoding.UTF8.GetBytes(body));

        return function.ProcessAsync(stream, CancellationToken.None);
    }

    [Fact]
    public async Task A_valid_request_maps_to_202_and_is_mailed()
    {
        var mailer = new StubMailer();

        var result = await Process(Create(mailer), ValidBody);

        Assert.Equal(HttpStatusCode.Accepted, result.Status);
        Assert.Single(mailer.Sent);
    }

    [Fact]
    public async Task A_body_over_the_cap_maps_to_413_before_parsing()
    {
        var mailer = new StubMailer();

        var result = await Process(Create(mailer, maxRequestBytes: 8), ValidBody);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, result.Status);
        Assert.Empty(mailer.Sent);
    }

    [Fact]
    public async Task Malformed_json_maps_to_400_with_a_body()
    {
        var result = await Process(Create(new StubMailer()), "not json");

        Assert.Equal(HttpStatusCode.BadRequest, result.Status);
        Assert.NotNull(result.Body);
    }

    [Fact]
    public async Task An_invalid_payload_maps_to_400()
    {
        var result = await Process(Create(new StubMailer()), """{"name":"","email":"x"}""");

        Assert.Equal(HttpStatusCode.BadRequest, result.Status);
        Assert.NotNull(result.Body);
    }

    [Fact]
    public async Task A_delivery_failure_maps_to_502()
    {
        var mailer = new StubMailer { Throw = new ContactMailException("down") };

        var result = await Process(Create(mailer), ValidBody);

        Assert.Equal(HttpStatusCode.BadGateway, result.Status);
        Assert.NotNull(result.Body);
    }

    [Fact]
    public async Task An_unexpected_exception_propagates_to_the_middleware_boundary()
    {
        var mailer = new StubMailer { Throw = new InvalidOperationException("boom") };

        await Assert.ThrowsAsync<InvalidOperationException>(() => Process(Create(mailer), ValidBody));
    }

    [Fact]
    public async Task Run_sets_the_mapped_status_after_writing_the_body()
    {
        var request = new FakeHttpRequestData(
            new FakeFunctionContext(),
            new MemoryStream(Encoding.UTF8.GetBytes("""{"name":"","email":"x"}""")));

        var response = await Create(new StubMailer()).Run(request, CancellationToken.None);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(response.Body.Length > 0);
    }

    [Fact]
    public async Task Run_returns_a_body_less_202_for_a_valid_request()
    {
        var request = new FakeHttpRequestData(
            new FakeFunctionContext(), new MemoryStream(Encoding.UTF8.GetBytes(ValidBody)));

        var response = await Create(new StubMailer()).Run(request, CancellationToken.None);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(0, response.Body.Length);
    }
}
