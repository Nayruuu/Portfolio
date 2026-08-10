namespace SuperDev.Application.Features.Contact;

public sealed class ContactMailException(string reason, Exception? inner = null)
    : Exception(reason, inner);
