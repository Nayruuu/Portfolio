using System.Net.Mail;
using System.Diagnostics.CodeAnalysis;

namespace SuperDev.Application.Models;

public sealed record ContactRequest(
    string? Name,
    string? Email,
    string? Subject,
    string? Message,
    string? Website)
{
    private const int NameMax = 100;
    private const int EmailMax = 320;
    private const int SubjectMax = 150;
    private const int MessageMax = 4000;

    public bool IsSpam => !string.IsNullOrWhiteSpace(Website);

    public bool TryParse(
        [NotNullWhen(true)] out ContactMessage? message,
        [NotNullWhen(false)] out IReadOnlyDictionary<string, string[]>? errors)
    {
        var found = new Dictionary<string, string[]>();
        MailAddress? address = null;

        if (string.IsNullOrWhiteSpace(Name) || Name.Length > NameMax)
        {
            found["name"] = [$"required, at most {NameMax} characters"];
        }
        if (string.IsNullOrWhiteSpace(Email) || Email.Length > EmailMax
            || !MailAddress.TryCreate(Email, out address))
        {
            found["email"] = ["a valid address is required"];
        }
        if (Subject is { Length: > SubjectMax })
        {
            found["subject"] = [$"at most {SubjectMax} characters"];
        }
        if (string.IsNullOrWhiteSpace(Message) || Message.Length > MessageMax)
        {
            found["message"] = [$"required, at most {MessageMax} characters"];
        }

        if (found.Count > 0)
        {
            message = null;
            errors = found;

            return false;
        }

        message = new ContactMessage(
            Name!.Trim(), address!.Address, Subject?.Trim() ?? "", Message!.Trim());
        errors = null;

        return true;
    }
}
