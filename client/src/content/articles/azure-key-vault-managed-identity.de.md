Ein Secret in einer `appsettings.json` ist ein Secret in Git und somit ein kompromittiertes Secret. Die idiomatische Antwort auf Azure: **Key Vault** zum Speichern der Secrets, **Managed Identity** für den Zugriff darauf ohne jegliches Passwort. Am Ende enthält Ihre Konfiguration keine einzige sensible Zeichenkette mehr.

## Die Authentifizierungsbarriere… die verschwindet

Das klassische Problem: Um ein Secret aus Key Vault zu lesen, muss sich die API authentifizieren – aber wo bewahrt man den Bezeichner auf, der zum Lesen der Bezeichner dient? Die **Managed Identity** durchbricht diesen Kreislauf. Azure weist Ihrer Ressource (Container App, App Service, VM) eine Identität zu; die Plattform injiziert und rotiert die Tokens. Auf der Codeseite existiert kein einziger Schlüssel.

Auf .NET-Seite verkettet `DefaultAzureCredential` mehrere Authentifizierungsquellen und wählt die erste aus, die antwortet – daher die Portabilität zwischen Entwicklungsrechner und Cloud.

```csharp
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;

var credential = new DefaultAzureCredential();
var client = new SecretClient(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    credential);

KeyVaultSecret secret = await client.GetSecretAsync("Db--ConnectionString");
```

## Key Vault als Konfigurationsprovider

Anstatt den `SecretClient` manuell aufzurufen, binden Sie Key Vault direkt in das ASP.NET Core-Konfigurationssystem ein. Alle Secrets werden zu gewöhnlichen Konfigurationseinträgen, zusammengeführt mit `appsettings.json` und den Umgebungsvariablen.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    new DefaultAzureCredential());

// Le secret "Db--ConnectionString" alimente Db:ConnectionString
var cs = builder.Configuration["Db:ConnectionString"];
```

Die Namenskonvention ist wichtig: Key Vault verbietet `:`, daher verwendet man `--` im Secret-Namen, das automatisch in ein Abschnittstrennzeichen übersetzt wird. `Db--ConnectionString` wird zu `Db:ConnectionString`, genau wie im Rest Ihrer typisierten Konfiguration.

## RBAC statt Access Policies

Key Vault bietet zwei Autorisierungsmodelle. Bevorzugen Sie **Azure RBAC**, das granularer und revisionssicherer ist als die alten Access Policies. Weisen Sie der Managed Identity die Rolle **Key Vault Secrets User** (Nur-Lesen der Secrets) zu, nicht mehr:

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

Die `$PRINCIPAL_ID` ist die `objectId` der Managed Identity, abrufbar nach deren Aktivierung auf der Ressource. Das Prinzip des **geringsten Privilegs** gilt: Ein Dienst, der nur Secrets liest, darf niemals die Rolle `Key Vault Secrets Officer` besitzen.

## Lokale Entwicklung vs. Cloud, ohne eine Zeile zu ändern

Genau das ist der Vorteil von `DefaultAzureCredential`: In der Produktion bezieht es das Token der Managed Identity; auf Ihrem Entwicklungsrechner wechselt es zur Identität der **Azure CLI** (`az login`) oder von Visual Studio. **Derselbe Code** funktioniert überall, vorausgesetzt, Ihr Konto verfügt ebenfalls über die Rolle `Key Vault Secrets User`. Die
[Dokumentation zu Key Vault + Managed Identity](https://learn.microsoft.com/azure/key-vault/general/authentication)
beschreibt die genaue Reihenfolge der Authentifizierungskette und deren Feinabstimmung.

> Das beste Secret ist eines, das man nie anfassen muss. Mit Managed Identity wird die Rotation von Azure verwaltet, und Ihr Git-Repository wird wieder das, was es immer hätte sein sollen: **bedenkenlos öffentlich**.
