Un secreto escrito en `appsettings.json` termina en el historial de Git, por lo tanto comprometido. La
solución idiomática en Azure: **Key Vault** para almacenar los secretos, **Managed Identity**
para acceder a ellos sin contraseña. Una vez ambos conectados, ni su configuración ni su
código contienen la más mínima cadena sensible.

## El secreto que sirve para leer los secretos

El problema de arranque es clásico: para leer un secreto en Key Vault, la API debe
autenticarse, y el identificador que sirve para leer los identificadores debe guardarse en
algún sitio. La **Managed Identity** elimina ese secreto inicial. Azure asigna una identidad a su
recurso (Container App, App Service, VM); la plataforma emite y rota los tokens.
En tiempo de ejecución, el host expone un punto de acceso local al token (las variables `IDENTITY_ENDPOINT`
en App Service y Container Apps, el IMDS `169.254.169.254` en una VM) que el SDK consulta.
Nada sensible toca el código ni la configuración.

Del lado de .NET, `DefaultAzureCredential` encadena varias fuentes de autenticación y retiene la
primera que responde. En la nube, es la identidad administrada; en local, una herramienta de desarrollador. El
mismo binario funciona en ambos lados.

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

`GetSecretAsync` devuelve un `Response<KeyVaultSecret>`: `secret.Value` lleva la cadena,
`secret.Properties` lleva los metadatos (versión, fecha de expiración, estado de activación).
Cada llamada toca el vault, un punto sobre el que vuelvo más abajo.

## System-assigned o user-assigned

Managed Identity existe en dos variantes, y la elección tiene consecuencias concretas.

La identidad **system-assigned** está ligada al ciclo de vida del recurso: creada con la app,
destruida con ella, una sola por recurso. Simple, pero solo existe una vez desplegada la app.
De ahí una molestia de arranque: no puede asignarle sus permisos RBAC antes de que
exista.

La identidad **user-assigned** es un recurso Azure independiente. La crea de antemano, le
otorga sus roles, y luego la vincula a una o varias apps. Sobrevive a la destrucción de una
app y se comparte entre varios servicios, por ejemplo una flota de workers que leen el
mismo vault. Es la opción correcta en cuanto un pipeline aprovisiona la infraestructura: el rol se
establece una vez, antes del primer despliegue del código.

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

Una trampa con el user-assigned: si la app tiene varias, `DefaultAzureCredential` no sabe
cuál usar. Hay que indicarle el `clientId` mediante
`DefaultAzureCredentialOptions { ManagedIdentityClientId = "..." }`.

## Key Vault como proveedor de configuración

En lugar de llamar al `SecretClient` manualmente en todas partes, conecte Key Vault directamente al
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

`AddAzureKeyVault` vive en el paquete `Azure.Extensions.AspNetCore.Configuration.Secrets`. La
convención de nomenclatura importa: Key Vault prohíbe el `:` en un nombre de secreto, así que se escribe
`--`, que el `KeyVaultSecretManager` por defecto retraduce como separador de sección.
`Db--ConnectionString` se convierte en `Db:ConnectionString`, exactamente igual que el resto de su config
tipada vinculada mediante `IOptions<T>`.

Por defecto, el proveedor carga todos los secretos del vault una sola vez, al arrancar. Mientras
la app está corriendo, nada se mueve. Tener esto en cuenta importa para la rotación.

## RBAC en lugar de las access policies

Key Vault ofrece dos modelos de autorización, mutuamente excluyentes a nivel del vault
(la propiedad `enableRbacAuthorization`). Prefiera el **RBAC de Azure**: utiliza los mismos
roles y la misma auditoría que el resto de sus recursos, mientras que las antiguas access policies
viven en un rincón aislado del vault.

Tres roles enmarcan la lectura. **Key Vault Secrets User** lee el valor de los secretos, eso es
todo lo que su API necesita. **Key Vault Reader** solo ve los metadatos (nombres,
versiones), nunca los valores. **Key Vault Secrets Officer** crea y elimina secretos; debe
quedarse en el pipeline y no tiene nada que hacer en una app de lectura.

```bash
az role assignment create \
  --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-super-dev/providers/Microsoft.KeyVault/vaults/kv-super-dev"
```

El `$PRINCIPAL_ID` es el `objectId` de la identidad administrada, devuelto al activarla en el
recurso. El **mínimo privilegio** se refleja tanto en el scope como en el rol: enmarque
la asignación en un solo vault, no en todo el resource group.

## Rotación y caché

Es la parte que se olvida. Un secreto termina por cambiar: fuga, expiración, rotación
planificada. Sin ajuste, su app conserva el valor antiguo hasta el próximo reinicio.

El proveedor de configuración acepta un `AzureKeyVaultConfigurationOptions.ReloadInterval`:
pásele un `TimeSpan` y volverá a buscar los secretos a intervalos regulares. Es **polling**,
no push: Key Vault no avisa a la app de un cambio, la app pregunta. Un intervalo de
unos minutos es un compromiso razonable entre frescura y volumen de llamadas.

El otro lado del asunto es la moderación. Cada `GetSecret` golpea el vault, que aplica un
throttling (del orden de unos pocos miles de transacciones por tramo de diez segundos, todos los
secretos combinados). Leer un secreto en cada petición HTTP es un anti-patrón: cárguelo al
arrancar, o póngalo en caché con un tiempo de vida, y deje que el `ReloadInterval` gestione la
rotación. El `SecretClient` no pone nada en caché por usted.

## Dev local y nube, el mismo código

En producción, `DefaultAzureCredential` obtiene el token de la identidad administrada. En su
equipo, desciende por la cadena hasta encontrar una sesión de desarrollador: el **Azure CLI**
(`az login`), Visual Studio, o el Azure Developer CLI. Ninguna variable ni archivo de secretos que
gestionar en local.

La única condición: su propia cuenta también debe tener el rol **Key Vault Secrets
User** en el vault, si no la llamada local devuelve un 403. La
[documentación de autenticación de Key Vault](https://learn.microsoft.com/azure/key-vault/general/authentication)
detalla el orden exacto de la cadena y cómo excluir de ella los eslabones innecesarios mediante
`DefaultAzureCredentialOptions`, lo que también acelera el arranque.

> Key Vault y Managed Identity retiran los secretos del código y de la configuración: viven en
> el vault, el acceso pasa por una identidad de plataforma, y la rotación no requiere un
> redespliegue. No queda nada que proteger en el repositorio.
