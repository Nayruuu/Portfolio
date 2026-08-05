Provisionar un clúster de Kubernetes para alojar una sola API .NET es administrar un
orquestador completo para una necesidad que cabe en unos pocos contenedores. **Azure Container Apps**
(ACA) ocupa el punto intermedio: serverless en contenedores. Se sube una imagen OCI, la plataforma
gestiona la orquestación, el escalado hasta **cero** réplicas y el enrutamiento HTTP, sin escribir
ni un solo manifiesto de Kubernetes. Internamente ACA se basa en AKS, KEDA, Dapr y Envoy, pero esas
piezas quedan fuera de la vista.

## El environment, la frontera compartida

Todo parte de un **environment**: la frontera que varias apps tienen en común. Las apps de un mismo
environment comparten una red virtual y escriben sus logs en el mismo workspace de Log
Analytics. Es también el nivel donde se declaran los componentes Dapr y los certificados.

Se crea una vez con `az containerapp env create --name env-super-dev --resource-group
rg-super-dev --location westeurope`, y luego se le adjuntan tantas apps como sea necesario.

Un environment se ofrece en **perfiles de carga**. El perfil Consumption facturaa por segundo el
vCPU y la memoria realmente asignados, y permite el scale-to-zero. El perfil Dedicated reserva
cómputo, útil para necesidades de memoria elevadas o un aislamiento más estricto, pero nunca baja
a cero. Para una API clásica, Consumption es la opción predeterminada razonable.

## Desplegar una imagen en un solo comando

La CLI `az containerapp up` hace todo el bootstrap en el primer despliegue: obtiene la imagen,
crea la app en el environment y devuelve su FQDN.

```bash
az containerapp up \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --environment env-super-dev \
  --image ghcr.io/super-dev/api:1.4.0 \
  --target-port 8080 \
  --ingress external \
  --query properties.configuration.ingress.fqdn
```

El `--target-port 8080` debe corresponder al puerto que **Kestrel** escucha dentro del contenedor,
lo cual se fija en el `Dockerfile` con `ASPNETCORE_URLS=http://+:8080`. La plataforma termina HTTPS
por delante: el contenedor habla HTTP en claro en su puerto, y ACA se encarga del TLS. Por tanto no
es necesario gestionar un certificado en Kestrel.

## Ingress y dominios personalizados

El ingress `external` publica un FQDN público en HTTPS con certificado gestionado por la
plataforma. El ingress `internal` reserva la app al tráfico intra-environment: es el ajuste
correcto para un servicio invocado solo por otras apps de la misma red. También se elige el
transporte (HTTP, HTTP/2 o TCP) y el puerto expuesto.

Para un nombre de dominio real, se añade el hostname y luego se lo vincula a un certificado, vía
`az containerapp hostname add` seguido de `az containerapp hostname bind`. ACA puede emitir un
**certificado gestionado gratuito** una vez que el registro DNS de validación está en su lugar, o
aceptar un certificado que usted proporcione.

Los pasos exactos están en la
[documentación de dominios personalizados](https://learn.microsoft.com/azure/container-apps/custom-domains-managed-certificates).

## Scale-to-zero y reglas de KEDA

El argumento económico se resume en una línea: con `--min-replicas 0`, una app inactiva no
consume ningún cómputo y por tanto no cuesta nada por ese concepto. En la primera solicitud, la
plataforma arranca una réplica; este despertar añade una latencia de arranque en frío cuya
magnitud depende sobre todo del tamaño de la imagen y del tiempo de inicialización de la app.

El escalado se basa en **KEDA**: se declaran reglas sobre métricas, no solo sobre la CPU.

```bash
az containerapp update \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --min-replicas 0 \
  --max-replicas 10 \
  --scale-rule-name http-rule \
  --scale-rule-type http \
  --scale-rule-http-concurrency 50
```

Aquí se añade una réplica por cada tramo de 50 solicitudes concurrentes. Para un worker que
consume una cola, se conecta más bien un scaler `azure-servicebus` o `azure-queue`: la app duerme
mientras la cola está vacía, luego escala según la profundidad de la queue, y vuelve a bajar a
cero una vez absorbido el backlog.

Un detalle a conocer: los scalers de CPU y memoria imponen un mínimo de una réplica, por lo que
excluyen el scale-to-zero. El [catálogo de scalers de KEDA](https://keda.sh/docs/latest/scalers/)
cubre Kafka, Redis, Prometheus y muchas otras fuentes.

## Revisiones y cambio de tráfico

Cada modificación de la **configuración del contenedor** (imagen, variables, recursos) crea una
nueva **revisión** inmutable. En modo `single`, solo la última revisión recibe tráfico. En modo
`multiple`, varias revisiones se ejecutan en paralelo y se distribuye el tráfico entre ellas: es
la base de un despliegue canary o blue/green.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

Aquí se envía un 10 % del tráfico hacia la nueva revisión. Si las métricas se mantienen, se pasa
el peso a `100`; si no, se vuelve a `0` de forma instantánea, sin redesplegar nada. El rollback se
mide en segundos porque la revisión anterior sigue ahí, caliente, lista para retomar la totalidad
del tráfico.

## Secretos, variables e identidad administrada

Las variables de entorno sensibles pasan por **secrets** definidos a nivel de la app,
referenciados en las variables mediante la sintaxis `secretref:`. El valor nunca aparece en claro
en la configuración de la revisión.

Con una **identidad administrada** activada en la app, un secret puede apuntar directamente a
Azure Key Vault: es ACA quien lee el valor al arrancar, autenticándose con la identidad, sin que
el secret llegue nunca a materializarse en la app.

```bash
az containerapp secret set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --secrets "db-conn=keyvaultref:https://kv-super-dev.vault.azure.net/secrets/db-conn,identityref:/subscriptions/.../userAssignedIdentities/id-super-dev"
```

La identidad debe tener el permiso de lectura sobre el vault (rol `Key Vault Secrets User` en
RBAC, o una access policy). La misma identidad sirve también para extraer la imagen de un registro
privado como ACR, lo que evita almacenar una contraseña de registro.

## El sidecar Dapr, cuando ayuda

Container Apps integra **Dapr** como opción. Activado por app con `--enable-dapr --dapr-app-id api
--dapr-app-port 8080`, añade un contenedor sidecar que expone los building blocks de Dapr:
llamadas servicio-a-servicio, pub/sub, state store, secret store. Los componentes (una cola
Service Bus para el pub/sub, un Cosmos DB para el estado) se declaran a nivel del environment y se
limitan a las apps autorizadas.

Dapr solo está justificado si se adopta su modelo. Para una API HTTP que habla con una base de
datos y nada más, el sidecar es un peso muerto: déjelo desactivado. Se vuelve interesante en cuanto
hay varios servicios que intercambian mensajes y comparten estado.

## Container Apps, App Service o AKS

ACA se sitúa entre dos opciones más antiguas. **App Service** sigue siendo la opción más simple
para una aplicación web o una API única: sin noción de revisión múltiple ni scaler que configurar,
y un modelo mental de PaaS muy directo. Muestra sus límites en cuanto se quieren varios
contenedores que colaboren, un escalado impulsado por una cola, o el scale-to-zero.

**AKS** es el otro extremo: Kubernetes completo, control total sobre la red, los node pools, los
controllers y los CRD. Ese control tiene un coste operativo real (upgrades del clúster, capacidad,
seguridad). Se elige cuando se necesitan las propias API de Kubernetes o un k8s existente que
reutilizar.

Container Apps apunta al término medio: microservicios en contenedores, escalado por eventos y
blue/green, sin clúster que administrar. Si su necesidad cabe en ese marco, suele ser el compromiso
correcto; la [documentación oficial](https://learn.microsoft.com/azure/container-apps/overview)
detalla el ingress, los health probes y las cuotas para un servicio de producción.

> Container Apps aplica el modelo serverless a los contenedores: se conserva la imagen OCI y el
> `Dockerfile`, sin gestionar un clúster. El scale-to-zero, las revisiones y el cambio de tráfico
> los proporciona la plataforma, y la identidad administrada conecta la app con Key Vault sin
> secretos en claro.
