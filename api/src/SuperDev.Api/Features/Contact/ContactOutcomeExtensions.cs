using System.Net;

using SuperDev.Api.Http.Responses;

using SuperDev.Application.Features.Contact;

namespace SuperDev.Api.Features.Contact;

internal static class ContactOutcomeExtensions
{
    private const string DeliveryFailedDetail =
        "The message could not be delivered — please retry or use a direct channel.";

    private const string UnverifiedDetail =
        "The anti-bot verification failed — please retry.";

    public static ApiResult ToApiResult(this ContactOutcome outcome) => outcome switch
    {
        ContactOutcome.Accepted => ApiResult.Empty(HttpStatusCode.Accepted),
        ContactOutcome.Invalid invalid => ApiResult.Errors(HttpStatusCode.BadRequest, invalid.Errors),
        ContactOutcome.Unverified => ApiResult.Detail(HttpStatusCode.Forbidden, UnverifiedDetail),
        ContactOutcome.DeliveryFailed => ApiResult.Detail(HttpStatusCode.BadGateway, DeliveryFailedDetail),
        _ => ApiResult.Empty(HttpStatusCode.InternalServerError),
    };
}
