using System.Net.Mail;
using System.Diagnostics.CodeAnalysis;

namespace SuperDev.Application.Features.Contact;

public sealed record ContactRequest(
    string? Name,
    string? Email,
    string? Subject,
    string? Message,
    string? Website,
    string? Altcha)
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
        var name = StripControl(Name ?? "");
        var subject = StripControl(Subject ?? "");
        MailAddress? address = null;

        if (name.Length is 0 or > NameMax)
        {
            found["name"] = [$"required, at most {NameMax} characters"];
        }
        if (string.IsNullOrWhiteSpace(Email) || Email.Length > EmailMax
            || !MailAddress.TryCreate(Email, out address))
        {
            found["email"] = ["a valid address is required"];
        }
        if (subject.Length > SubjectMax)
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

        message = new ContactMessage(name, address!.Address, subject, Message!.Trim());
        errors = null;

        return true;
    }

    private static string StripControl(string value) =>
        string.Concat(value.Where(character => !char.IsControl(character))).Trim();
}
