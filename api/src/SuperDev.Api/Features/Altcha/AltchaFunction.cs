using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

using SuperDev.Application.Features.Altcha;

namespace SuperDev.Api.Features.Altcha;

public sealed class AltchaFunction(IAltcha altcha)
{
    [Function("altcha")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "altcha")] HttpRequestData request,
        CancellationToken cancellationToken)
    {
        var response = request.CreateResponse();

        await response.WriteAsJsonAsync(altcha.CreateChallenge(), cancellationToken);

        return response;
    }
}
