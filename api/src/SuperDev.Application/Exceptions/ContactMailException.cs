namespace SuperDev.Application.Exceptions;

public sealed class ContactMailException(string reason, Exception? inner = null)
    : Exception(reason, inner);
