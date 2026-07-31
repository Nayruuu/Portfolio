Un secreto escrito en `appsettings.json` termina en el historial de Git, por lo tanto comprometido. La
solución idiomática en Azure: **Key Vault** para almacenar los secretos, **Managed Identity**
para acceder a ellos sin contraseña. Una vez conectados ambos, tu configuración ya no
contiene ninguna cadena sensible.

## El muro de autenticación que desaparece

El problema clásico: para leer un secreto en Key Vault, la API debe autenticarse, y
el identificador que sirve para leer los identificadores debe estar guardado en algún sitio. La
**Managed Identity** rompe este círculo. Azure asigna una identidad a tu recurso
(Container App, App Service, VM); la plataforma inyecta y rota los tokens. No existe
ninguna clave del lado del código.

Del lado de .NET, `DefaultAzureCredential` encadena varias fuentes de autenticación y
selecciona la primera que responde. Esto es lo que hace que el mismo código sea portable entre
la máquina de desarrollo y la nube.

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

En lugar de llamar al `SecretClient` manualmente, conecta Key Vault directamente al
sistema de configuración de ASP.NET Core. Todos los secretos se convierten en entradas de configuración
ordinarias, fusionadas con `appsettings.json` y las variables de entorno.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-super-dev.vault.azure.net/"),
    new DefaultAzureCredential());

// The "Db--ConnectionString" secret feeds Db:ConnectionString
var cs = builder.Configuration["Db:ConnectionString"];
```

La convención de nomenclatura importa: Key Vault prohíbe los `:`, así que se usa `--` en el nombre
del secreto, traducido automáticamente en separador de sección. `Db--ConnectionString` se convierte
en `Db:ConnectionString`, exactamente igual que en el resto de tu configuración tipada.

## RBAC en lugar de las access policies

Key Vault propone dos modelos de autorización. Prefiere el **RBAC de Azure**, más granular y
auditable que las antiguas access policies. Otorga a la identidad administrada el rol
**Key Vault Secrets User** (solo lectura de secretos), nada más:

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

El `$PRINCIPAL_ID` es el `objectId` de la identidad administrada, recuperable tras su activación en
el recurso. El principio del **mínimo privilegio** se aplica: un servicio que solo lee
secretos nunca debe tener el rol `Key Vault Secrets Officer`.

## Desarrollo local vs nube, sin cambiar una línea

Esa es la ventaja de `DefaultAzureCredential`: en producción, obtiene el token de
la identidad administrada; en tu máquina, cambia a la identidad de la **Azure CLI**
(`az login`) o de Visual Studio.

El **mismo código** funciona en todas partes, con una condición: tu cuenta también debe tener el
rol `Key Vault Secrets User`. La
[documentación de Key Vault + identidad administrada](https://learn.microsoft.com/azure/key-vault/general/authentication)
detalla el orden exacto de la cadena de autenticación y su ajuste fino.

> El mejor secreto es el que nunca hay que manipular. Con Managed Identity, la rotación
> la gestiona Azure, y tu repositorio Git puede ser **público sin peligro**.
