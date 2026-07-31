Provisioning a Kubernetes cluster to host a single API is overkill. **Azure
Container Apps** offers containerized serverless: you push an image, the platform handles
orchestration, scaling (down to **zero**) and routing, without ever writing a
Kubernetes manifest.

## Deploy an image in one command

Container Apps relies on an **environment** (the network and logging boundary shared by
several apps) and then on individual apps. The `az containerapp up` CLI does all the
bootstrap work on the first deployment:

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

The `--target-port 8080` must match the port **Kestrel** listens on inside the container
(`ASPNETCORE_URLS=http://+:8080`). `external` ingress exposes a public HTTPS FQDN with a
managed certificate; `internal` restricts the app to intra-environment traffic, the right
choice for a service called only by other apps.

## Scale-to-zero and KEDA rules

The economic argument: with `--min-replicas 0`, an idle app **costs nothing**. On the
first request, the platform starts a replica (cold start of a few hundred
milliseconds). Scaling relies on **KEDA**: rules are declared on metrics, not
just on CPU.

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

Here a new replica is added for every batch of 50 concurrent requests. For a worker
consuming a queue, an `azure-servicebus` or `azure-queue` scaler is used: the app sleeps
as long as the queue is empty, then scales up according to queue depth. The
[KEDA scalers catalog](https://keda.sh/docs/latest/scalers/) covers Kafka, Redis,
Prometheus, and many others.

## Revisions and traffic split

Every change to the **container configuration** (image, variables, resources) creates
a new immutable **revision**. In `multiple` mode, several revisions run in
parallel and traffic is split between them, which serves as the basis for a canary
or blue-green deployment.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

Here **10%** of traffic is sent to the new revision. If the metrics hold up, you
switch to `100`; otherwise you revert to `0` instantly, without redeploying. Rollback
happens on the order of seconds.

## Managing configuration cleanly

Sensitive environment variables go through app **secrets**, referenced via the
`secretref:` syntax. With **managed identity** enabled on the app, a secret can point
directly to Azure Key Vault, without ever materializing the value.

The [Container Apps documentation](https://learn.microsoft.com/azure/container-apps/overview)
details ingress, Dapr, and the health probes (`liveness`/`readiness`) to wire up for a
production service.

> Container Apps applies the serverless model to containers: you keep your OCI image and your
> `Dockerfile`, without managing a cluster. Scale-to-zero and traffic split are provided by the
> platform.
