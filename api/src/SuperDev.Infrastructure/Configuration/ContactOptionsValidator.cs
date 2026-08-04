using Microsoft.Extensions.Options;

namespace SuperDev.Infrastructure.Configuration;

public sealed class ContactOptionsValidator : IValidateOptions<ContactOptions>
{
    public ValidateOptionsResult Validate(string? name, ContactOptions options)
    {
        var failures = new List<string>();

        if (options.MaxRequestBytes <= 0)
        {
            failures.Add("Contact:MaxRequestBytes must be greater than 0.");
        }
        if (options.RateLimitPerMinute <= 0)
        {
            failures.Add("Contact:RateLimitPerMinute must be greater than 0.");
        }
        if (string.IsNullOrWhiteSpace(options.ResendApiKey))
        {
            failures.Add("Contact:ResendApiKey is required.");
        }
        if (string.IsNullOrWhiteSpace(options.From))
        {
            failures.Add("Contact:From is required.");
        }
        if (string.IsNullOrWhiteSpace(options.To))
        {
            failures.Add("Contact:To is required.");
        }

        return failures.Count > 0
            ? ValidateOptionsResult.Fail(failures)
            : ValidateOptionsResult.Success;
    }
}
