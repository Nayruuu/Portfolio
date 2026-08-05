namespace SuperDev.Application.Features.Altcha;

public interface IAltcha
{
    public AltchaChallenge CreateChallenge();

    public bool Verify(string? payload);
}
