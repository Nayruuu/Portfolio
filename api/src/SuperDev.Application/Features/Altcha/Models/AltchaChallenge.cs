namespace SuperDev.Application.Features.Altcha;

public sealed record AltchaChallenge(
    string Algorithm,
    string Challenge,
    int Maxnumber,
    string Salt,
    string Signature);
