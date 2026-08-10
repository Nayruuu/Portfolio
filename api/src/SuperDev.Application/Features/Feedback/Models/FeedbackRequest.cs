using System.Diagnostics.CodeAnalysis;

namespace SuperDev.Application.Features.Feedback;

public sealed record FeedbackRequest(string? Vote, string? Page)
{
    // Shared by the write (parse) and read (count) paths.
    public const int PageMax = 300;

    public bool TryParse(
        [NotNullWhen(true)] out FeedbackCommand? command, [NotNullWhen(false)] out string? error)
    {
        command = null;
        error = null;
        var page = StripControl(Page ?? "");

        if (page.Length is 0 or > PageMax)
        {
            error = $"page is required, at most {PageMax} characters";

            return false;
        }

        var trimmed = Vote?.Trim();

        if (string.IsNullOrEmpty(trimmed))
        {
            command = new FeedbackCommand(page, null);
        }
        else if (string.Equals(trimmed, "up", StringComparison.OrdinalIgnoreCase))
        {
            command = new FeedbackCommand(page, "up");
        }
        else if (string.Equals(trimmed, "down", StringComparison.OrdinalIgnoreCase))
        {
            command = new FeedbackCommand(page, "down");
        }
        else
        {
            error = "vote must be 'up', 'down', or empty to retract";

            return false;
        }

        return true;
    }

    private static string StripControl(string value) =>
        string.Concat(value.Where(character => !char.IsControl(character))).Trim();
}
