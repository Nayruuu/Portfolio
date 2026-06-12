## El muro de autenticación… que desaparece

El problema clásico: para leer un secreto en Key Vault, la API debe autenticarse — pero ¿dónde guardar el identificador que sirve para leer los identificadores? La **Managed Identity** rompe este círculo. Azure asigna una identidad a su recurso (Container App, App Service, VM); la plataforma inyecta y rota los tokens. No existe ninguna clave en el código.

En el lado .NET, `DefaultAzureCredential` encadena varias fuentes de autenticación y selecciona la primera que responde — de ahí la portabilidad entre el equipo local de desarrollo y la nube.

```csharp
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;

var credential = new DefaultAzureCredential();
var client = new SecretClient(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    credential);

KeyVaultSecret secret = await client.GetSecretAsync("Db--ConnectionString");
```

## Key Vault como proveedor de configuración

En lugar de llamar al `SecretClient` manualmente, conecte Key Vault directamente al sistema de configuración de ASP.NET Core. Todos los secretos se convierten en entradas de configuración ordinarias, fusionadas con `appsettings.json` y las variables de entorno.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    new DefaultAzureCredential());

// El secreto "Db--ConnectionString" alimenta Db:ConnectionString
var cs = builder.Configuration["Db:ConnectionString"];
```

La convención de nomenclatura importa: Key Vault prohíbe el `:`, por lo que se usa `--` en el nombre del secreto, traducido automáticamente al separador de sección. `Db--ConnectionString` se convierte en `Db:ConnectionString`, exactamente como en el resto de su configuración tipada.

## RBAC en lugar de las access policies

Key Vault ofrece dos modelos de autorización. Prefiera el **RBAC de Azure**, más granular y auditable que las antiguas access policies. Otorgue a la identidad administrada el rol **Key Vault Secrets User** (solo lectura de secretos), nada más:

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

El `$PRINCIPAL_ID` es el `objectId` de la identidad administrada, recuperable tras su activación en el recurso. El principio de **mínimo privilegio** se aplica: un servicio que solo lee secretos nunca debe poseer el rol `Key Vault Secrets Officer`.

## Dev local vs nube, sin cambiar una línea

Esta es la ventaja de `DefaultAzureCredential`: en producción obtiene el token de la identidad administrada; en su equipo local, cambia a la identidad de la **Azure CLI** (`az login`) o de Visual Studio. El **mismo código** funciona en todas partes, siempre que su cuenta también disponga del rol `Key Vault Secrets User`. La
[documentación de Key Vault + identidad administrada](https://learn.microsoft.com/azure/key-vault/general/authentication)
detalla el orden exacto de la cadena de autenticación y su ajuste fino.

> El mejor secreto es aquel que nunca hay que manipular. Con Managed Identity, la rotación la gestiona Azure, y su repositorio Git vuelve a ser lo que siempre debió haber sido: **público sin riesgo**.
