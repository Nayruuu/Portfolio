using System.Net;

using SuperDev.Api.Http.Responses;

using SuperDev.Application.Features.Feedback;

namespace SuperDev.Api.Features.Feedback;

internal static class FeedbackOutcomeExtensions
{
    public static ApiResult ToApiResult(this FeedbackOutcome outcome) => outcome switch
    {
        FeedbackOutcome.Recorded recorded => ApiResult.Json(HttpStatusCode.OK, recorded.Tally),
        FeedbackOutcome.Invalid invalid => ApiResult.Detail(HttpStatusCode.BadRequest, invalid.Error),
        _ => ApiResult.Empty(HttpStatusCode.InternalServerError),
    };
}
