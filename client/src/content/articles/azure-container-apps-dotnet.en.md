Provisioning a Kubernetes cluster to host a single .NET API means administering a complete
orchestrator for a need that fits in a handful of containers. **Azure Container Apps**
(ACA) sits in between: containerized serverless. You push an OCI image, the platform
handles orchestration, scaling down to **zero** replicas, and HTTP routing, without writing a
single Kubernetes manifest. Internally ACA relies on AKS, KEDA, Dapr, and Envoy, but these building
blocks stay out of view.

## The environment, the shared boundary

Everything starts from an **environment**: the boundary that several apps have in common. Apps in the same
environment share a virtual network and write their logs to the same Log
Analytics workspace. It's also the level at which Dapr components and certificates are declared.

You create it once with `az containerapp env create --name env-super-dev --resource-group
rg-super-dev --location westeurope`, then attach as many apps to it as needed.

An environment comes in **workload profiles**. The Consumption profile bills per second for the
vCPU and memory actually allocated, and it allows scale-to-zero. The Dedicated profile reserves
compute, useful for high memory needs or stricter isolation, but never scales
down to zero. For a typical API, Consumption is the reasonable default.

## Deploying an image in one command

The `az containerapp up` CLI does all the bootstrapping on the first deployment: it fetches the image,
creates the app in the environment, and returns its FQDN.

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

The `--target-port 8080` must match the port that **Kestrel** listens on inside the container, which
you set on the `Dockerfile` side with `ASPNETCORE_URLS=http://+:8080`. The platform terminates HTTPS
upstream: the container speaks plain HTTP on its port, ACA handles TLS. No need to manage
a certificate in Kestrel.

## Ingress and custom domains

`external` ingress publishes a public FQDN over HTTPS with a platform-managed certificate.
`internal` ingress restricts the app to intra-environment traffic: this is the right setting for a
service called only by other apps on the same network. You also choose the transport (HTTP,
HTTP/2, or TCP) and the exposed port.

For a real domain name, you add the hostname and then bind it to a certificate, via
`az containerapp hostname add` followed by `az containerapp hostname bind`. ACA can issue a
**free managed certificate** once the validation DNS record is in place, or accept a
certificate you provide.

The exact steps are in the
[custom domains documentation](https://learn.microsoft.com/azure/container-apps/custom-domains-managed-certificates).

## Scale-to-zero and KEDA rules

The economic argument fits in one line: with `--min-replicas 0`, an idle app consumes
no compute and therefore costs nothing on that front. On the first request, the platform starts a
replica; this wake-up adds a cold-start latency whose size mainly depends on the
image size and the app's initialization time.

Scaling relies on **KEDA**: you declare rules on metrics, not just on CPU.

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

Here a replica is added for every 50 concurrent requests. For a worker that consumes a
queue, you instead wire up an `azure-servicebus` or `azure-queue` scaler: the app sleeps while the queue
is empty, then scales up according to the queue depth, and scales back down to zero once the
backlog is absorbed.

One detail worth knowing: the CPU and memory scalers impose a minimum of one replica, so they
rule out scale-to-zero. The [KEDA scaler catalog](https://keda.sh/docs/latest/scalers/)
covers Kafka, Redis, Prometheus, and many other sources.

## Revisions and traffic switching

Every change to the **container configuration** (image, variables, resources) creates a
new immutable **revision**. In `single` mode, only the latest revision receives traffic. In
`multiple` mode, several revisions run in parallel and traffic is split between them:
this is the basis for a canary or blue/green deployment.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

Here 10% of traffic is sent to the new revision. If the metrics hold up, you bump the
weight to `100`; otherwise you set it back to `0` instantly, without redeploying anything. The
rollback takes seconds because the old revision is still there, warm, ready to
take back all the traffic.

## Secrets, variables, and managed identity

Sensitive environment variables go through **secrets** defined at the app level,
referenced in the variables via the `secretref:` syntax. The value never appears in plain text
in the revision configuration.

With a **managed identity** enabled on the app, a secret can point directly to Azure Key
Vault: ACA reads the value at startup, authenticating with the identity, without ever
materializing the secret in the app.

```bash
az containerapp secret set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --secrets "db-conn=keyvaultref:https://kv-super-dev.vault.azure.net/secrets/db-conn,identityref:/subscriptions/.../userAssignedIdentities/id-super-dev"
```

The identity must have read access to the vault (the `Key Vault Secrets User` role in RBAC, or
an access policy). The same identity is also used to pull the image from a private registry like ACR,
which avoids storing a registry password.

## The Dapr sidecar, when it helps

Container Apps optionally integrates **Dapr**. Enabled per app with `--enable-dapr --dapr-app-id api
--dapr-app-port 8080`, it adds a sidecar container that exposes Dapr building blocks: service-to-service
calls, pub/sub, state store, secret store. The components (a Service Bus queue for
pub/sub, a Cosmos DB for state) are declared at the environment level and scoped to the
authorized apps.

Dapr is only worth it if you adopt its model. For an HTTP API that talks to a
database and nothing else, the sidecar is dead weight: leave it disabled. It becomes
worthwhile as soon as there are several services exchanging messages and sharing state.

## Container Apps, App Service, or AKS

ACA sits between two older options. **App Service** remains the simplest choice for
a web application or a single API: no notion of multiple revisions or scalers to
configure, and a very direct PaaS mental model. It shows its limits as soon as you want several
containers collaborating, scaling driven by a queue, or scale-to-zero.

**AKS** is the other extreme: full Kubernetes, complete control over the network, node pools,
controllers, and CRDs. That control comes with a real operational cost (cluster upgrades,
capacity, security). You choose it when you need the Kubernetes APIs themselves or an
existing k8s setup to reuse.

Container Apps targets the middle ground: containerized microservices, event-driven scaling, and
blue/green, without a cluster to administer. If your need fits within that scope, it's often the right
compromise; the [official documentation](https://learn.microsoft.com/azure/container-apps/overview)
covers ingress, health probes, and quotas for a production service.

> Container Apps applies the serverless model to containers: you keep your OCI image and your
> `Dockerfile`, without managing a cluster. Scale-to-zero, revisions, and traffic switching are
> provided by the platform, and managed identity connects the app to Key Vault without a secret in plain text.
