Provisioning a Kubernetes cluster to host a single API is bringing a sledgehammer to crack a
nut. **Azure Container Apps** delivers serverless containers: you push an image, and the
platform handles orchestration, scaling — down to **zero** — and routing, all without ever
writing a Kubernetes manifest.

## Deploy an image in one command

Container Apps builds on an **environment** (the shared networking and logging boundary for
several apps) and then on individual apps. The `az containerapp up` CLI does all the bootstrap
work on the first deployment:

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
(`ASPNETCORE_URLS=http://+:8080`). The `external` ingress exposes a public HTTPS FQDN with a
managed certificate; `internal` keeps the app on intra-environment traffic only — ideal for a
service called solely by other apps.

## Scale-to-zero and KEDA rules

The decisive cost argument: with `--min-replicas 0`, an idle app **costs nothing**. On the
first request the platform spins up a replica (a cold start of a few hundred milliseconds).
Scaling rests on **KEDA**: you declare rules against metrics, not just CPU.

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

Here a new replica is added per 50 concurrent requests. For a worker draining a queue you use
an `azure-servicebus` or `azure-queue` scaler: the app sleeps while the queue is empty, then
scales out based on queue depth. The
[KEDA scaler catalogue](https://keda.sh/docs/latest/scalers/) covers Kafka, Redis, Prometheus
and many more.

## Revisions and traffic split

Every change to the **container configuration** (image, variables, resources) creates a new
immutable **revision**. In `multiple` mode, several revisions run in parallel and you split
traffic across them — the foundation of a canary or blue-green rollout.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

This sends **10%** of traffic to the new revision. If the metrics hold, you bump it to `100`;
otherwise you drop it back to `0` instantly — no redeploy required. That is a rollback measured
in seconds.

## Handle configuration cleanly

Sensitive environment variables go through app **secrets**, referenced via the `secretref:`
syntax. Better still: enable a **managed identity** on the app and point a secret straight at
Azure Key Vault, so the value is never materialised. The
[Container Apps documentation](https://learn.microsoft.com/azure/container-apps/overview)
details ingress, Dapr and the health probes (`liveness`/`readiness`) you should wire up for a
production service.

> Container Apps is serverless without giving up containers: you keep your OCI image and your
> `Dockerfile`, but you **forget the cluster**. Scale-to-zero and traffic split come free.
