using System.Text.Json;

using Azure.Core.Serialization;

using Microsoft.Extensions.Hosting;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;

using SuperDev.Api.Middleware;

using SuperDev.Infrastructure.DependencyInjection;

var builder = FunctionsApplication.CreateBuilder(args);

builder.Services.AddApplicationInsightsTelemetryWorkerService();
builder.Services.ConfigureFunctionsApplicationInsights();
builder.Services.Configure<WorkerOptions>(options =>
    options.Serializer = new JsonObjectSerializer(new JsonSerializerOptions(JsonSerializerDefaults.Web)));
builder.Services.AddSuperDevApi(builder.Configuration);

builder.UseMiddleware<ExceptionHandlingMiddleware>();
builder.UseMiddleware<RateLimitingMiddleware>();

builder.Build().Run();
