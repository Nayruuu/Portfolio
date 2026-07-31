Ein Secret, das in `appsettings.json` geschrieben steht, landet in der Git-Historie und ist damit kompromittiert. Die
idiomatische Lösung auf Azure: **Key Vault** zum Speichern der Secrets, **Managed Identity**,
um darauf ohne Passwort zuzugreifen. Sind beide einmal angebunden, enthält Ihre Konfiguration
keine sensible Zeichenfolge mehr.

## Die Authentifizierungsmauer, die verschwindet

Das klassische Problem: Um ein Secret in Key Vault zu lesen, muss sich die API authentifizieren, und
die Zugangsdaten, die zum Lesen der Zugangsdaten dienen, müssen ja auch irgendwo abgelegt sein. Die
**Managed Identity** durchbricht diesen Kreis. Azure weist Ihrer Ressource eine Identität zu
(Container App, App Service, VM); die Plattform injiziert und rotiert die Tokens. Auf Code-Seite
existiert kein einziger Schlüssel.

Auf .NET-Seite verkettet `DefaultAzureCredential` mehrere Authentifizierungsquellen und
wählt die erste aus, die antwortet. Das macht denselben Code zwischen Dev-Rechner und Cloud
portabel.

```csharp
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;

var credential = new DefaultAzureCredential();
var client = new SecretClient(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    credential);

KeyVaultSecret secret = await client.GetSecretAsync("Db--ConnectionString");
```

## Key Vault als Konfigurations-Provider

Statt den `SecretClient` manuell aufzurufen, binden Sie Key Vault direkt an das
ASP.NET-Core-Konfigurationssystem an. Alle Secrets werden zu gewöhnlichen Konfigurationseinträgen,
zusammengeführt mit `appsettings.json` und den Umgebungsvariablen.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    new DefaultAzureCredential());

// The "Db--ConnectionString" secret feeds Db:ConnectionString
var cs = builder.Configuration["Db:ConnectionString"];
```

Die Namenskonvention ist entscheidend: Key Vault verbietet `:`, daher verwendet man `--` im
Secret-Namen, was automatisch in einen Abschnittstrenner übersetzt wird. `Db--ConnectionString` wird zu
`Db:ConnectionString`, genau wie im Rest Ihrer typisierten Konfiguration.

## RBAC statt Access Policies

Key Vault bietet zwei Autorisierungsmodelle. Bevorzugen Sie **Azure RBAC**, das granularer und
auditierbarer ist als die alten Access Policies. Weisen Sie der Managed Identity die Rolle
**Key Vault Secrets User** zu (nur Lesezugriff auf Secrets), nicht mehr:

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

`$PRINCIPAL_ID` ist die `objectId` der Managed Identity, abrufbar nach ihrer Aktivierung auf
der Ressource. Das Prinzip der **geringsten Rechte** gilt: Ein Dienst, der nur Secrets liest,
darf niemals die Rolle `Key Vault Secrets Officer` besitzen.

## Lokale Entwicklung vs. Cloud, ohne eine Zeile zu ändern

Das ist der ganze Sinn von `DefaultAzureCredential`: In der Produktion holt es sich das Token der
Managed Identity; auf Ihrem Rechner wechselt es zur Identität der **Azure CLI**
(`az login`) oder von Visual Studio.

Der **gleiche Code** funktioniert überall, unter einer Bedingung: Ihr Konto muss ebenfalls die
Rolle `Key Vault Secrets User` besitzen. Die
[Key-Vault- und Managed-Identity-Dokumentation](https://learn.microsoft.com/azure/key-vault/general/authentication)
beschreibt die genaue Reihenfolge der Authentifizierungskette und deren Feinabstimmung.

> Das beste Secret ist das, mit dem man nie hantieren muss. Mit Managed Identity wird die Rotation
> von Azure verwaltet, und Ihr Git-Repository kann **gefahrlos öffentlich** sein.
