using System.Net;
using System.Text;

namespace SuperDev.Infrastructure.Tests.Fakes;

public sealed class RecordingHttpHandler(HttpStatusCode status, string responseBody) : HttpMessageHandler
{
    public HttpRequestMessage? LastRequest { get; private set; }

    public string? LastRequestBody { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastRequest = request;
        LastRequestBody = request.Content is null
            ? null
            : await request.Content.ReadAsStringAsync(cancellationToken);

        return new HttpResponseMessage(status)
        {
            Content = new StringContent(responseBody, Encoding.UTF8, "application/json"),
        };
    }
}
