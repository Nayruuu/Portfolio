Provisionar un clúster de Kubernetes para alojar una sola API es desproporcionado. **Azure
Container Apps** ofrece el serverless containerizado: se sube una imagen, la plataforma gestiona
la orquestación, el escalado (hasta **cero**) y el enrutamiento, sin escribir jamás un manifiesto
de Kubernetes.

## Desplegar una imagen en un solo comando

Container Apps se apoya en un **environment** (la frontera de red y de logs compartida por
varias apps) y luego en apps individuales. La CLI `az containerapp up` hace todo el
trabajo de bootstrap en el primer despliegue:

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

El `--target-port 8080` debe corresponder al puerto que **Kestrel** escucha en el contenedor
(`ASPNETCORE_URLS=http://+:8080`). El ingress `external` expone un FQDN HTTPS público con
certificado gestionado; `internal` reserva la app al tráfico intra-environment, la opción
correcta para un servicio llamado solo por otras apps.

## Scale-to-zero y reglas KEDA

El argumento económico: con `--min-replicas 0`, una app inactiva **no cuesta nada**. En la
primera solicitud, la plataforma arranca una réplica (cold start de unos cientos de
milisegundos). El escalado se basa en **KEDA**: se declaran reglas sobre métricas, no
solo sobre la CPU.

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

Aquí se añade una nueva réplica por cada 50 solicitudes concurrentes. Para un worker
que consume una cola, se usa un scaler `azure-servicebus` o `azure-queue`: la app duerme
mientras la cola está vacía, y luego escala según la profundidad de la queue. El
[catálogo de scalers KEDA](https://keda.sh/docs/latest/scalers/) cubre Kafka, Redis,
Prometheus y muchos otros.

## Revisiones y traffic split

Cada modificación de la **configuración del contenedor** (imagen, variables, recursos) crea
una nueva **revisión** inmutable. En modo `multiple`, varias revisiones se ejecutan en
paralelo y se reparte el tráfico entre ellas, lo que sirve de base para un despliegue canary
o blue-green.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

Aquí se envía **10 %** del tráfico hacia la nueva revisión. Si las métricas se sostienen, se
pasa a `100`; si no, se vuelve a `0` instantáneamente, sin redesplegar. El rollback se
mide en segundos.

## Gestionar la configuración correctamente

Las variables de entorno sensibles pasan por **secrets** de la app, referenciados mediante la
sintaxis `secretref:`. Con la **identidad administrada** activada en la app, un secret puede
apuntar directamente a Azure Key Vault, sin materializar jamás el valor.

La [documentación de Container Apps](https://learn.microsoft.com/azure/container-apps/overview)
detalla el ingress, Dapr y las sondas de salud (`liveness`/`readiness`) que hay que cablear para
un servicio de producción.

> Container Apps aplica el modelo serverless a los contenedores: se conserva la imagen OCI y el
> `Dockerfile`, sin gestionar ningún clúster. Scale-to-zero y traffic split los proporciona la
> plataforma.
