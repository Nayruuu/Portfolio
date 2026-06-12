Un secret dans un `appsettings.json`, c'est un secret dans Git, donc un secret compromis. La
parade idiomatique sur Azure : **Key Vault** pour stocker les secrets, **Managed Identity**
pour y accéder sans le moindre mot de passe. Au bout du compte, votre configuration ne
contient plus aucune chaîne sensible.

## Le mur d'authentification… qui disparaît

Le problème classique : pour lire un secret dans Key Vault, l'API doit s'authentifier — mais
où ranger l'identifiant qui sert à lire les identifiants ? La **Managed Identity** brise ce
cercle. Azure attribue une identité à votre ressource (Container App, App Service, VM) ; la
plateforme injecte et fait tourner les tokens. Aucune clé n'existe côté code.

Côté .NET, `DefaultAzureCredential` enchaîne plusieurs sources d'authentification et
sélectionne la première qui répond — d'où la portabilité entre poste de dev et cloud.

```csharp
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;

var credential = new DefaultAzureCredential();
var client = new SecretClient(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    credential);

KeyVaultSecret secret = await client.GetSecretAsync("Db--ConnectionString");
```

## Key Vault comme provider de configuration

Plutôt que d'appeler le `SecretClient` à la main, branchez Key Vault directement sur le
système de configuration ASP.NET Core. Tous les secrets deviennent des entrées de configuration
ordinaires, fusionnées avec `appsettings.json` et les variables d'environnement.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    new DefaultAzureCredential());

// Le secret "Db--ConnectionString" alimente Db:ConnectionString
var cs = builder.Configuration["Db:ConnectionString"];
```

La convention de nommage compte : Key Vault interdit le `:`, donc on utilise `--` dans le nom
du secret, automatiquement traduit en séparateur de section. `Db--ConnectionString` devient
`Db:ConnectionString`, exactement comme dans le reste de votre config typée.

## RBAC plutôt que les access policies

Key Vault propose deux modèles d'autorisation. Préférez le **RBAC Azure**, plus granulaire et
auditable que les anciennes access policies. Donnez à l'identité managée le rôle
**Key Vault Secrets User** (lecture seule des secrets), pas davantage :

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

Le `$PRINCIPAL_ID` est l'`objectId` de l'identité managée, récupérable après son activation sur
la ressource. Le principe du **moindre privilège** s'applique : un service qui ne fait que lire
des secrets ne doit jamais détenir le rôle `Key Vault Secrets Officer`.

## Dev local vs cloud, sans changer une ligne

C'est tout l'intérêt de `DefaultAzureCredential` : en production il pioche le token de
l'identité managée ; sur votre poste, il bascule sur l'identité de l'**Azure CLI**
(`az login`) ou de Visual Studio. Le **même code** fonctionne partout, à condition que votre
compte dispose lui aussi du rôle `Key Vault Secrets User`. La
[documentation Key Vault + identité managée](https://learn.microsoft.com/azure/key-vault/general/authentication)
détaille l'ordre exact de la chaîne d'authentification et son réglage fin.

> Le meilleur secret est celui qu'on n'a jamais à manipuler. Avec Managed Identity, la rotation
> est gérée par Azure, et votre dépôt Git redevient ce qu'il aurait toujours dû être : **public
> sans danger**.
