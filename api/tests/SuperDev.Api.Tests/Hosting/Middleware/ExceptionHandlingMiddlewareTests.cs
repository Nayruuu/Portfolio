using System.Net;
using System.Text;

using Microsoft.Extensions.Logging.Abstractions;

using SuperDev.Api.Middleware;
using SuperDev.Api.Tests.Fakes;

namespace SuperDev.Api.Tests.Middleware;

public sealed class ExceptionHandlingMiddlewareTests
{
    private static ExceptionHandlingMiddleware Create() =>
        new(NullLogger<ExceptionHandlingMiddleware>.Instance);

    [Fact]
    public async Task A_successful_invocation_flows_through_untouched()
    {
        var reached = false;

        await Create().Invoke(new FakeFunctionContext(), _ =>
        {
            reached = true;

            return Task.CompletedTask;
        });

        Assert.True(reached);
    }

    [Fact]
    public async Task A_cancellation_propagates_rather_than_being_swallowed()
    {
        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            Create().Invoke(new FakeFunctionContext(), _ => throw new OperationCanceledException()));
    }

    [Fact]
    public async Task An_unhandled_error_is_rendered_as_a_generic_500_that_leaks_nothing()
    {
        var request = new FakeHttpRequestData(new FakeFunctionContext(), Stream.Null);

        var response = await ExceptionHandlingMiddleware.BuildErrorResponse(request, CancellationToken.None);
        response.Body.Position = 0;
        var body = await new StreamReader(response.Body, Encoding.UTF8).ReadToEndAsync();

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Contains("An unexpected error occurred.", body, StringComparison.Ordinal);
    }
}
