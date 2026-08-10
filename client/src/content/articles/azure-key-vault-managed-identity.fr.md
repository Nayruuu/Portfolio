Un secret écrit dans `appsettings.json` finit dans l'historique Git, donc compromis. La
parade idiomatique sur Azure : **Key Vault** pour stocker les secrets, **Managed Identity**
pour y accéder sans mot de passe. Une fois les deux branchés, ni votre configuration ni votre
code ne contiennent la moindre chaîne sensible.

## Le secret qui sert à lire les secrets

Le problème d'amorçage est classique : pour lire un secret dans Key Vault, l'API doit
s'authentifier, et l'identifiant qui sert à lire les identifiants doit bien être rangé quelque
part. La **Managed Identity** supprime ce secret initial. Azure attribue une identité à votre
ressource (Container App, App Service, VM) ; la plateforme émet et fait tourner les tokens.
Au runtime, l'hôte expose un point d'accès local au token (les variables `IDENTITY_ENDPOINT`
sur App Service et Container Apps, l'IMDS `169.254.169.254` sur une VM) que le SDK interroge.
Rien de sensible ne touche le code ni la config.

Côté .NET, `DefaultAzureCredential` enchaîne plusieurs sources d'authentification et retient la
première qui répond. En cloud, c'est l'identité managée ; en local, un outil de développeur. Le
même binaire fonctionne des deux côtés.

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

`GetSecretAsync` renvoie un `Response<KeyVaultSecret>` : `secret.Value` porte la chaîne,
`secret.Properties` porte les métadonnées (version, date d'expiration, état d'activation).
Chaque appel touche le vault, un point sur lequel je reviens plus bas.

## System-assigned ou user-assigned

Managed Identity existe en deux variantes, et le choix a des conséquences concrètes.

L'identité **system-assigned** est liée au cycle de vie de la ressource : créée avec l'app,
détruite avec elle, une seule par ressource. Simple, mais elle n'existe qu'une fois l'app
déployée. D'où une gêne d'amorçage : vous ne pouvez pas lui attribuer ses droits RBAC avant
qu'elle existe.

L'identité **user-assigned** est une ressource Azure autonome. Vous la créez en amont, lui
donnez ses rôles, puis l'attachez à une ou plusieurs apps. Elle survit à la destruction d'une
app et se partage entre plusieurs services, par exemple une flotte de workers qui lisent le
même vault. C'est le bon choix dès qu'un pipeline provisionne l'infrastructure : le rôle est
posé une fois, avant le premier déploiement du code.

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

Un piège avec l'user-assigned : si l'app en porte plusieurs, `DefaultAzureCredential` ne sait
pas laquelle utiliser. Il faut lui indiquer le `clientId` via
`DefaultAzureCredentialOptions { ManagedIdentityClientId = "..." }`.

## Key Vault comme provider de configuration

Plutôt que d'appeler le `SecretClient` à la main partout, branchez Key Vault directement sur le
système de configuration ASP.NET Core. Tous les secrets deviennent des entrées de configuration
ordinaires, fusionnées avec `appsettings.json` et les variables d'environnement.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    new DefaultAzureCredential());

// The "Db--ConnectionString" secret feeds Db:ConnectionString
var cs = builder.Configuration["Db:ConnectionString"];
```

`AddAzureKeyVault` vit dans le paquet `Azure.Extensions.AspNetCore.Configuration.Secrets`. La
convention de nommage compte : Key Vault interdit le `:` dans un nom de secret, donc on écrit
`--`, que le `KeyVaultSecretManager` par défaut retraduit en séparateur de section.
`Db--ConnectionString` devient `Db:ConnectionString`, exactement comme le reste de votre config
typée liée par `IOptions<T>`.

Par défaut, le provider charge tous les secrets du vault une seule fois, au démarrage. Tant que
l'app tourne, rien ne bouge. Garder ça en tête compte pour la rotation.

## RBAC plutôt que les access policies

Key Vault propose deux modèles d'autorisation, exclusifs l'un de l'autre au niveau du vault
(la propriété `enableRbacAuthorization`). Préférez le **RBAC Azure** : il utilise les mêmes
rôles et le même audit que le reste de vos ressources, là où les anciennes access policies
vivent dans un coin isolé du vault.

Trois rôles cadrent la lecture. **Key Vault Secrets User** lit la valeur des secrets, c'est
tout ce dont votre API a besoin. **Key Vault Reader** ne voit que les métadonnées (noms,
versions), jamais les valeurs. **Key Vault Secrets Officer** crée et supprime des secrets ; il
reste au pipeline et n'a rien à faire dans une app de lecture.

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

Le `$PRINCIPAL_ID` est l'`objectId` de l'identité managée, renvoyé à son activation sur la
ressource. Le **moindre privilège** se lit dans le scope autant que dans le rôle : cadrez
l'attribution sur un seul vault, pas sur le resource group entier.

## Rotation et cache

C'est la partie qu'on oublie. Un secret finit par changer : fuite, expiration, rotation
planifiée. Sans réglage, votre app garde l'ancienne valeur jusqu'au prochain redémarrage.

Le provider de configuration accepte un `AzureKeyVaultConfigurationOptions.ReloadInterval` :
passez-lui un `TimeSpan` et il repioche les secrets à intervalle régulier. C'est du **polling**,
pas du push : Key Vault ne prévient pas l'app d'un changement, l'app interroge. Un intervalle de
quelques minutes est un compromis raisonnable entre fraîcheur et volume d'appels.

L'autre côté du sujet, c'est la retenue. Chaque `GetSecret` frappe le vault, qui applique un
throttling (de l'ordre de quelques milliers de transactions par tranche de dix secondes, tous
secrets confondus). Lire un secret à chaque requête HTTP est un anti-pattern : chargez-le au
démarrage, ou mettez-le en cache avec une durée de vie, et laissez le `ReloadInterval` gérer la
rotation. Le `SecretClient` ne met rien en cache pour vous.

## Dev local et cloud, le même code

En production, `DefaultAzureCredential` récupère le token de l'identité managée. Sur votre
poste, il descend la chaîne jusqu'à trouver une session de développeur : l'**Azure CLI**
(`az login`), Visual Studio, ou l'Azure Developer CLI. Aucune variable ni fichier de secret à
gérer en local.

La seule condition : votre propre compte doit lui aussi détenir le rôle **Key Vault Secrets
User** sur le vault, sinon l'appel local renvoie un 403. La
[documentation d'authentification Key Vault](https://learn.microsoft.com/azure/key-vault/general/authentication)
détaille l'ordre exact de la chaîne et comment en exclure les maillons inutiles via
`DefaultAzureCredentialOptions`, ce qui accélère aussi le démarrage.

> Key Vault et Managed Identity retirent les secrets du code et de la config : ils vivent dans
> le vault, l'accès passe par une identité de plateforme, et la rotation ne demande pas de
> redéploiement. Il ne reste rien à protéger dans le dépôt.
