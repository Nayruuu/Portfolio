Ein Secret, das in `appsettings.json` steht, landet in der Git-Historie und ist damit kompromittiert. Die
idiomatische Lösung auf Azure: **Key Vault** zum Speichern der Secrets, **Managed Identity**,
um passwortlos darauf zuzugreifen. Sind beide einmal verdrahtet, enthalten weder Ihre Konfiguration noch Ihr
Code auch nur eine einzige sensible Zeichenkette.

## Das Secret, das zum Lesen der Secrets dient

Das Bootstrapping-Problem ist klassisch: Um ein Secret in Key Vault zu lesen, muss sich die API
authentifizieren, und die Kennung, die zum Lesen der Kennungen dient, muss ja auch irgendwo abgelegt
werden. Die **Managed Identity** beseitigt dieses initiale Secret. Azure weist Ihrer
Ressource (Container App, App Service, VM) eine Identität zu; die Plattform stellt die Tokens aus und rotiert sie.
Zur Laufzeit stellt der Host einen lokalen Zugriffspunkt für den Token bereit (die Variablen `IDENTITY_ENDPOINT`
bei App Service und Container Apps, der IMDS `169.254.169.254` bei einer VM), den das SDK abfragt.
Nichts Sensibles berührt den Code oder die Konfiguration.

Auf .NET-Seite reiht `DefaultAzureCredential` mehrere Authentifizierungsquellen aneinander und behält
die erste, die antwortet. In der Cloud ist das die Managed Identity; lokal ein Entwickler-Tool. Dasselbe
Binary funktioniert auf beiden Seiten.

```csharp
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;

var credential = new DefaultAzureCredential();
var client = new SecretClient(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    credential);

KeyVaultSecret secret = await client.GetSecretAsync("Db--ConnectionString");
string connectionString = secret.Value;
```

`GetSecretAsync` liefert eine `Response<KeyVaultSecret>`: `secret.Value` trägt die Zeichenkette,
`secret.Properties` trägt die Metadaten (Version, Ablaufdatum, Aktivierungsstatus).
Jeder Aufruf erreicht den Vault, ein Punkt, auf den ich weiter unten zurückkomme.

## System-assigned oder user-assigned

Managed Identity existiert in zwei Varianten, und die Wahl hat konkrete Konsequenzen.

Die **system-assigned** Identität ist an den Lebenszyklus der Ressource gebunden: erstellt mit der App,
zerstört mit ihr, nur eine pro Ressource. Einfach, aber sie existiert erst, wenn die App
bereits deployt ist. Daraus folgt ein Bootstrapping-Problem: Sie können ihr die RBAC-Rechte nicht zuweisen, bevor
sie existiert.

Die **user-assigned** Identität ist eine eigenständige Azure-Ressource. Sie erstellen sie im Voraus,
weisen ihr ihre Rollen zu und hängen sie dann an eine oder mehrere Apps an. Sie überlebt die Zerstörung einer
App und lässt sich zwischen mehreren Diensten teilen, zum Beispiel eine Flotte von Workern, die denselben
Vault lesen. Das ist die richtige Wahl, sobald eine Pipeline die Infrastruktur provisioniert: Die Rolle wird
einmal gesetzt, vor dem ersten Deployment des Codes.

```bash
# System-assigned: born and dies with the app
az containerapp identity assign \
  --name api-super-dev --resource-group rg-super-dev \
  --system-assigned

# User-assigned: a standalone resource you attach to the app
az identity create --name id-api --resource-group rg-super-dev
az containerapp identity assign \
  --name api-super-dev --resource-group rg-super-dev \
  --user-assigned /subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-api
```

Eine Falle bei user-assigned: Trägt die App mehrere davon, weiß `DefaultAzureCredential` nicht,
welche zu verwenden ist. Man muss ihr die `clientId` mitteilen, über
`DefaultAzureCredentialOptions { ManagedIdentityClientId = "..." }`.

## Key Vault als Configuration-Provider

Statt den `SecretClient` überall manuell aufzurufen, verdrahten Sie Key Vault direkt mit dem
Konfigurationssystem von ASP.NET Core. Alle Secrets werden zu gewöhnlichen Konfigurationseinträgen,
zusammengeführt mit `appsettings.json` und den Umgebungsvariablen.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    new DefaultAzureCredential());

// The "Db--ConnectionString" secret feeds Db:ConnectionString
var cs = builder.Configuration["Db:ConnectionString"];
```

`AddAzureKeyVault` lebt im Paket `Azure.Extensions.AspNetCore.Configuration.Secrets`. Die
Namenskonvention zählt: Key Vault verbietet den `:` in einem Secret-Namen, also schreibt man
`--`, was der `KeyVaultSecretManager` standardmäßig wieder in den Abschnittstrenner übersetzt.
`Db--ConnectionString` wird zu `Db:ConnectionString`, genau wie der Rest Ihrer typisierten Konfiguration,
die über `IOptions<T>` gebunden wird.

Standardmäßig lädt der Provider alle Secrets des Vaults nur einmal, beim Start. Solange
die App läuft, bewegt sich nichts. Das im Hinterkopf zu behalten zählt für die Rotation.

## RBAC statt der Access Policies

Key Vault bietet zwei Autorisierungsmodelle, die sich auf Vault-Ebene gegenseitig ausschließen
(die Eigenschaft `enableRbacAuthorization`). Bevorzugen Sie **Azure RBAC**: Es nutzt dieselben
Rollen und dasselbe Audit wie der Rest Ihrer Ressourcen, während die alten Access Policies
in einer isolierten Ecke des Vaults leben.

Drei Rollen rahmen das Lesen ein. **Key Vault Secrets User** liest den Wert der Secrets, das ist
alles, was Ihre API braucht. **Key Vault Reader** sieht nur die Metadaten (Namen,
Versionen), niemals die Werte. **Key Vault Secrets Officer** erstellt und löscht Secrets; er
bleibt der Pipeline vorbehalten und hat in einer lesenden App nichts zu suchen.

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

Die `$PRINCIPAL_ID` ist die `objectId` der Managed Identity, zurückgegeben bei ihrer Aktivierung auf der
Ressource. Das **Least Privilege**-Prinzip zeigt sich im Scope genauso wie in der Rolle: Rahmen Sie
die Zuweisung auf einen einzigen Vault ein, nicht auf die gesamte Resource Group.

## Rotation und Cache

Das ist der Teil, den man vergisst. Ein Secret ändert sich irgendwann: Leak, Ablauf,
geplante Rotation. Ohne Einstellung behält Ihre App den alten Wert bis zum nächsten Neustart.

Der Configuration-Provider akzeptiert ein `AzureKeyVaultConfigurationOptions.ReloadInterval`:
Übergeben Sie ihm eine `TimeSpan`, und er holt die Secrets in regelmäßigen Abständen erneut ab. Das ist
**Polling**, kein Push: Key Vault benachrichtigt die App nicht über eine Änderung, die App fragt nach. Ein Intervall von
einigen Minuten ist ein vernünftiger Kompromiss zwischen Aktualität und Aufrufvolumen.

Die andere Seite des Themas ist die Zurückhaltung. Jedes `GetSecret` trifft den Vault, der ein
Throttling anwendet (in der Größenordnung von einigen Tausend Transaktionen pro Zehn-Sekunden-Fenster, über alle
Secrets hinweg). Ein Secret bei jedem HTTP-Request zu lesen, ist ein Anti-Pattern: Laden Sie es beim
Start, oder cachen Sie es mit einer Lebensdauer, und überlassen Sie dem `ReloadInterval` die
Rotation. Der `SecretClient` cacht nichts für Sie.

## Lokale Entwicklung und Cloud, derselbe Code

In Produktion holt `DefaultAzureCredential` den Token der Managed Identity. Auf Ihrem
Rechner steigt es die Kette hinab, bis es eine Entwickler-Session findet: die **Azure CLI**
(`az login`), Visual Studio oder die Azure Developer CLI. Keine Variable und keine Secret-Datei
lokal zu verwalten.

Die einzige Bedingung: Ihr eigenes Konto muss ebenfalls die Rolle **Key Vault Secrets
User** auf dem Vault innehaben, sonst liefert der lokale Aufruf einen 403 zurück. Die
[Key-Vault-Authentifizierungsdokumentation](https://learn.microsoft.com/azure/key-vault/general/authentication)
beschreibt die genaue Reihenfolge der Kette und wie man unnötige Glieder über
`DefaultAzureCredentialOptions` ausschließt, was auch den Start beschleunigt.

> Key Vault und Managed Identity entfernen die Secrets aus Code und Konfiguration: Sie leben
> im Vault, der Zugriff läuft über eine Plattform-Identität, und die Rotation erfordert kein
> erneutes Deployment. Im Repository bleibt nichts mehr zu schützen.
