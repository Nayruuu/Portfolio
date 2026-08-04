using Microsoft.Extensions.Hosting;
using Microsoft.Azure.Functions.Worker.Builder;

using SuperDev.Api.Middleware;

using SuperDev.Infrastructure.Extensions;

var builder = FunctionsApplication.CreateBuilder(args);

builder.Services.AddContact(builder.Configuration);

builder.UseMiddleware<ExceptionHandlingMiddleware>();
builder.UseMiddleware<RateLimitingMiddleware>();

builder.Build().Run();
