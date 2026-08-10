using Microsoft.Extensions.Options;

namespace SuperDev.Infrastructure.Features.Altcha;

public sealed class AltchaOptionsValidator : IValidateOptions<AltchaOptions>
{
    public ValidateOptionsResult Validate(string? name, AltchaOptions options)
    {
        var failures = new List<string>();

        if (string.IsNullOrWhiteSpace(options.HmacKey))
        {
            failures.Add("Altcha:HmacKey is required.");
        }
        if (options.MaxNumber <= 0)
        {
            failures.Add("Altcha:MaxNumber must be greater than 0.");
        }
        if (options.ExpirySeconds <= 0)
        {
            failures.Add("Altcha:ExpirySeconds must be greater than 0.");
        }

        return failures.Count > 0
            ? ValidateOptionsResult.Fail(failures)
            : ValidateOptionsResult.Success;
    }
}
