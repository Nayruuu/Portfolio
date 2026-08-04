using System.Net;

using SuperDev.Api.Http.Responses;

using SuperDev.Application.Models;

namespace SuperDev.Api.Functions;

internal static class ContactOutcomeExtensions
{
    private const string DeliveryFailedDetail =
        "The message could not be delivered — please retry or use a direct channel.";

    public static ApiResult ToApiResult(this ContactOutcome outcome) => outcome switch
    {
        ContactOutcome.Accepted => ApiResult.Empty(HttpStatusCode.Accepted),
        ContactOutcome.Invalid invalid => ApiResult.Errors(HttpStatusCode.BadRequest, invalid.Errors),
        ContactOutcome.DeliveryFailed => ApiResult.Detail(HttpStatusCode.BadGateway, DeliveryFailedDetail),
        _ => ApiResult.Empty(HttpStatusCode.InternalServerError),
    };
}
