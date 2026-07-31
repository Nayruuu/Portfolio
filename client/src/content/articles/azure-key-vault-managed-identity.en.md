A secret written in `appsettings.json` ends up in the Git history, and is therefore
compromised. The idiomatic remedy on Azure: **Key Vault** to store secrets, **Managed
Identity** to access them without a password. Once both are wired up, your configuration no
longer contains a single sensitive string.

## The authentication wall that disappears

The classic problem: to read a secret in Key Vault, the API must authenticate, and the
credential used to read credentials has to be stored somewhere too. **Managed Identity**
breaks this circle. Azure assigns an identity to your resource (Container App, App Service,
VM); the platform injects and rotates the tokens. No key exists on the code side.

On the .NET side, `DefaultAzureCredential` chains several authentication sources and picks
the first one that responds. That's what makes the same code portable between a dev
machine and the cloud.

```csharp
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;

var credential = new DefaultAzureCredential();
var client = new SecretClient(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    credential);

KeyVaultSecret secret = await client.GetSecretAsync("Db--ConnectionString");
```

## Key Vault as a configuration provider

Rather than calling the `SecretClient` by hand, wire Key Vault directly into the ASP.NET
Core configuration system. All secrets become ordinary configuration entries, merged with
`appsettings.json` and environment variables.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    new DefaultAzureCredential());

// The "Db--ConnectionString" secret feeds Db:ConnectionString
var cs = builder.Configuration["Db:ConnectionString"];
```

The naming convention matters: Key Vault forbids `:`, so `--` is used in the secret name,
automatically translated into a section separator. `Db--ConnectionString` becomes
`Db:ConnectionString`, exactly like the rest of your typed config.

## RBAC rather than access policies

Key Vault offers two authorization models. Prefer **Azure RBAC**, more granular and
auditable than the older access policies. Grant the managed identity the **Key Vault
Secrets User** role (read-only access to secrets), nothing more:

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

`$PRINCIPAL_ID` is the `objectId` of the managed identity, retrievable once it's been
enabled on the resource. The **least-privilege** principle applies: a service that only
reads secrets should never hold the `Key Vault Secrets Officer` role.

## Local dev vs cloud, without changing a line

That's the whole point of `DefaultAzureCredential`: in production, it picks up the managed
identity's token; on your machine, it falls back to the **Azure CLI** identity (`az login`)
or Visual Studio's.

The **same code** works everywhere, on one condition: your account must also hold the
`Key Vault Secrets User` role. The
[Key Vault + managed identity documentation](https://learn.microsoft.com/azure/key-vault/general/authentication)
details the exact order of the authentication chain and how to fine-tune it.

> The best secret is the one you never have to handle. With Managed Identity, rotation is
> managed by Azure, and your Git repo can be **public without risk**.
