A secret written in `appsettings.json` ends up in Git history, hence compromised. The
idiomatic remedy on Azure: **Key Vault** to store secrets, **Managed Identity**
to access them without a password. Once both are wired up, neither your configuration nor your
code contains a single sensitive string.

## The secret used to read secrets

The bootstrapping problem is a classic one: to read a secret in Key Vault, the API must
authenticate, and the credential used to read credentials has to be stored somewhere
too. **Managed Identity** removes that initial secret. Azure assigns an identity to your
resource (Container App, App Service, VM); the platform issues and rotates the tokens.
At runtime, the host exposes a local token endpoint (the `IDENTITY_ENDPOINT` variables
on App Service and Container Apps, the IMDS `169.254.169.254` on a VM) that the SDK queries.
Nothing sensitive touches the code or the config.

On the .NET side, `DefaultAzureCredential` chains several authentication sources and keeps the
first one that responds. In the cloud, it's the managed identity; locally, a developer tool. The
same binary works on both sides.

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

`GetSecretAsync` returns a `Response<KeyVaultSecret>`: `secret.Value` carries the string,
`secret.Properties` carries the metadata (version, expiration date, enabled state).
Each call hits the vault, a point I come back to further down.

## System-assigned or user-assigned

Managed Identity comes in two flavors, and the choice has concrete consequences.

The **system-assigned** identity is tied to the resource's lifecycle: created with the app,
destroyed with it, one per resource. Simple, but it only exists once the app has been
deployed. Hence a bootstrapping hassle: you can't grant it its RBAC rights before
it exists.

The **user-assigned** identity is a standalone Azure resource. You create it upfront,
grant it its roles, then attach it to one or several apps. It survives the destruction of an
app and can be shared across several services, for example a fleet of workers that read the
same vault. It's the right choice as soon as a pipeline provisions the infrastructure: the role is
set once, before the first code deployment.

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

One pitfall with user-assigned identities: if the app carries several, `DefaultAzureCredential` doesn't know
which one to use. You need to point it to the `clientId` via
`DefaultAzureCredentialOptions { ManagedIdentityClientId = "..." }`.

## Key Vault as a configuration provider

Rather than calling the `SecretClient` by hand everywhere, wire Key Vault directly into the
ASP.NET Core configuration system. All secrets become ordinary configuration entries, merged
with `appsettings.json` and environment variables.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    new DefaultAzureCredential());

// The "Db--ConnectionString" secret feeds Db:ConnectionString
var cs = builder.Configuration["Db:ConnectionString"];
```

`AddAzureKeyVault` lives in the `Azure.Extensions.AspNetCore.Configuration.Secrets` package. The
naming convention matters: Key Vault forbids `:` in a secret name, so you write
`--`, which the default `KeyVaultSecretManager` translates back into a section separator.
`Db--ConnectionString` becomes `Db:ConnectionString`, exactly like the rest of your typed config
bound via `IOptions<T>`.

By default, the provider loads all the vault's secrets once, at startup. As long as
the app is running, nothing changes. Keeping that in mind matters for rotation.

## RBAC rather than access policies

Key Vault offers two authorization models, mutually exclusive at the vault level
(the `enableRbacAuthorization` property). Prefer **Azure RBAC**: it uses the same
roles and the same audit trail as the rest of your resources, whereas the legacy access policies
live off in an isolated corner of the vault.

Three roles frame the read path. **Key Vault Secrets User** reads the value of secrets, that's
all your API needs. **Key Vault Reader** only sees the metadata (names,
versions), never the values. **Key Vault Secrets Officer** creates and deletes secrets; it
stays with the pipeline and has no business in a read-only app.

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

`$PRINCIPAL_ID` is the `objectId` of the managed identity, returned when it's enabled on the
resource. **Least privilege** shows up in the scope as much as in the role: scope
the assignment to a single vault, not to the whole resource group.

## Rotation and caching

This is the part everyone forgets. A secret eventually changes: a leak, an expiration, a planned
rotation. Without any tuning, your app keeps the old value until the next restart.

The configuration provider accepts an `AzureKeyVaultConfigurationOptions.ReloadInterval`:
pass it a `TimeSpan` and it re-fetches the secrets at a regular interval. This is **polling**,
not push: Key Vault doesn't notify the app of a change, the app queries it. An interval of
a few minutes is a reasonable trade-off between freshness and call volume.

The other side of the topic is restraint. Every `GetSecret` hits the vault, which applies
throttling (on the order of a few thousand transactions per ten-second window, across all
secrets). Reading a secret on every HTTP request is an anti-pattern: load it at
startup, or cache it with a lifetime, and let `ReloadInterval` handle the
rotation. `SecretClient` doesn't cache anything for you.

## Local dev and the cloud, the same code

In production, `DefaultAzureCredential` fetches the token from the managed identity. On your
machine, it walks down the chain until it finds a developer session: the **Azure CLI**
(`az login`), Visual Studio, or the Azure Developer CLI. No variable or secret file to
manage locally.

The only condition: your own account must also hold the **Key Vault Secrets
User** role on the vault, otherwise the local call returns a 403. The
[Key Vault authentication documentation](https://learn.microsoft.com/azure/key-vault/general/authentication)
details the exact order of the chain and how to exclude unneeded links from it via
`DefaultAzureCredentialOptions`, which also speeds up startup.

> Key Vault and Managed Identity remove secrets from code and config: they live in
> the vault, access goes through a platform identity, and rotation doesn't require a
> redeployment. There's nothing left to protect in the repo.
