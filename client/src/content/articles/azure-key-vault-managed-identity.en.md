A secret in `appsettings.json` is a secret in Git, and therefore a compromised secret. The
idiomatic answer on Azure: **Key Vault** to store secrets, **Managed Identity** to reach them
without a single password. The end result is a configuration that holds no sensitive string at
all.

## The auth wall… that vanishes

The classic chicken-and-egg problem: to read a secret from Key Vault the API must
authenticate — but where do you store the credential used to read the credentials? **Managed
Identity** breaks that loop. Azure assigns an identity to your resource (Container App, App
Service, VM); the platform injects and rotates the tokens. No key ever exists in your code.

On the .NET side, `DefaultAzureCredential` chains several authentication sources and picks the
first that responds — which is exactly what makes it portable between dev box and cloud.

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

Rather than calling the `SecretClient` by hand, plug Key Vault straight into the ASP.NET Core
configuration system. Every secret becomes an ordinary configuration entry, merged with
`appsettings.json` and environment variables.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    new DefaultAzureCredential());

// The "Db--ConnectionString" secret feeds Db:ConnectionString
var cs = builder.Configuration["Db:ConnectionString"];
```

The naming convention matters: Key Vault forbids `:`, so you use `--` in the secret name, which
is automatically translated into a section separator. `Db--ConnectionString` becomes
`Db:ConnectionString`, exactly like the rest of your strongly-typed config.

## RBAC over access policies

Key Vault offers two authorization models. Prefer **Azure RBAC**, which is more granular and
auditable than the legacy access policies. Grant the managed identity the
**Key Vault Secrets User** role (read-only access to secrets), and nothing more:

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

The `$PRINCIPAL_ID` is the `objectId` of the managed identity, retrievable once it is enabled
on the resource. The **least-privilege** principle applies: a service that only reads secrets
should never hold the `Key Vault Secrets Officer` role.

## Local dev vs cloud, without changing a line

This is the whole point of `DefaultAzureCredential`: in production it pulls the token from the
managed identity; on your machine it falls back to your **Azure CLI** identity (`az login`) or
Visual Studio. The **same code** runs everywhere, provided your own account also holds the
`Key Vault Secrets User` role. The
[Key Vault + managed identity documentation](https://learn.microsoft.com/azure/key-vault/general/authentication)
details the exact ordering of the authentication chain and how to fine-tune it.

> The best secret is the one you never have to handle. With Managed Identity, rotation is
> Azure's job, and your Git repository goes back to what it always should have been: **safe to
> make public**.
