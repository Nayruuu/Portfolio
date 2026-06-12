## Desplegar una imagen con un solo comando

Container Apps se apoya en un **environment** (la frontera de red y de logs compartida por varias apps) y luego en apps individuales. La CLI `az containerapp up` hace todo el trabajo de bootstrap en el primer despliegue:

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

El `--target-port 8080` debe coincidir con el puerto que **Kestrel** escucha en el contenedor (`ASPNETCORE_URLS=http://+:8080`). El ingress `external` expone un FQDN HTTPS público con certificado gestionado; `internal` reserva la app al tráfico intra-environment, ideal para un servicio llamado solo por otras apps.

## Scale-to-zero y reglas KEDA

El argumento económico decisivo: con `--min-replicas 0`, una app inactiva **no cuesta nada**. En la primera solicitud, la plataforma arranca una réplica (cold start de unos pocos cientos de milisegundos). El scaling se basa en **KEDA**: se declaran reglas sobre métricas, no solo sobre la CPU.

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

Aquí se añade una nueva réplica por cada 50 solicitudes concurrentes. Para un worker que consume una cola, se usa un scaler `azure-servicebus` o `azure-queue`: la app duerme mientras la cola está vacía y luego escala según la profundidad de la cola. El [catálogo de scalers KEDA](https://keda.sh/docs/latest/scalers/) cubre Kafka, Redis, Prometheus y muchos más.

## Revisiones y traffic split

Cada modificación de la **configuración del contenedor** (imagen, variables, recursos) crea una nueva **revisión** inmutable. En modo `multiple`, varias revisiones corren en paralelo y se distribuye el tráfico — la base de un despliegue canary o blue-green.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

Aquí se envía el **10 %** del tráfico a la nueva revisión. Si las métricas se mantienen, se cambia a `100`; si no, se vuelve a `0` instantáneamente — sin redesplegar. Es un rollback que se mide en segundos.

## Gestionar la configuración correctamente

Las variables de entorno sensibles se gestionan mediante **secrets** de app, referenciados con la sintaxis `secretref:`. Mejor aún: active la **identidad administrada** en la app y apunte un secret directamente a Azure Key Vault, sin materializar nunca el valor. La [documentación de Container Apps](https://learn.microsoft.com/azure/container-apps/overview) detalla ingress, Dapr y las sondas de salud (`liveness`/`readiness`) que hay que cablear para un servicio de producción.

> Container Apps es el serverless sin renunciar a los contenedores: se mantiene la imagen OCI y el `Dockerfile`, pero se **olvida el clúster**. Scale-to-zero y traffic split incluidos.
