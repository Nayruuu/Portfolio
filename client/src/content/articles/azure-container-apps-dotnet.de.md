Die Provisionierung eines Kubernetes-Clusters, um eine einzelne API zu hosten, ist unverhältnismäßig. **Azure
Container Apps** bietet containerisiertes Serverless: Man pusht ein Image, die Plattform übernimmt
die Orchestrierung, das Scaling (bis auf **null**) und das Routing, ohne je ein Kubernetes-Manifest
zu schreiben.

## Ein Image mit einem einzigen Befehl deployen

Container Apps stützt sich auf ein **Environment** (die Netzwerk- und Log-Grenze, die von
mehreren Apps gemeinsam genutzt wird) und darauf aufbauend auf individuelle Apps. Die CLI
`az containerapp up` erledigt beim ersten Deployment die gesamte Bootstrap-Arbeit:

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

`--target-port 8080` muss dem Port entsprechen, auf dem **Kestrel** im Container lauscht
(`ASPNETCORE_URLS=http://+:8080`). Der Ingress `external` exponiert einen öffentlichen HTTPS-FQDN mit
verwaltetem Zertifikat; `internal` beschränkt die App auf Traffic innerhalb des Environments,
die richtige Wahl für einen Service, der nur von anderen Apps aufgerufen wird.

## Scale-to-Zero und KEDA-Regeln

Das wirtschaftliche Argument: Mit `--min-replicas 0` **kostet** eine inaktive App **nichts**. Bei der
ersten Anfrage startet die Plattform ein Replica (Cold Start von einigen hundert Millisekunden).
Das Scaling basiert auf **KEDA**: Man deklariert Regeln auf Basis von Metriken, nicht nur auf CPU.

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

Hier wird pro 50 gleichzeitige Anfragen ein neues Replica hinzugefügt. Für einen Worker, der eine
Queue konsumiert, verwendet man einen `azure-servicebus`- oder `azure-queue`-Scaler: Die App schläft,
solange die Queue leer ist, und skaliert dann je nach Tiefe der Queue hoch. Der
[Katalog der KEDA-Scaler](https://keda.sh/docs/latest/scalers/) deckt Kafka, Redis,
Prometheus und viele weitere ab.

## Revisionen und Traffic-Split

Jede Änderung der **Container-Konfiguration** (Image, Variablen, Ressourcen) erzeugt eine neue,
unveränderliche **Revision**. Im Modus `multiple` laufen mehrere Revisionen parallel, und man
verteilt den Traffic zwischen ihnen, was als Grundlage für ein Canary- oder Blue-Green-Deployment
dient.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

Hier werden **10 %** des Traffics an die neue Revision gesendet. Wenn die Metriken stimmen, schaltet
man auf `100`; andernfalls geht man sofort auf `0` zurück, ohne neu zu deployen. Der Rollback ist
eine Frage von Sekunden.

## Konfiguration sauber verwalten

Sensible Umgebungsvariablen laufen über App-**Secrets**, referenziert über die
`secretref:`-Syntax. Mit aktivierter **Managed Identity** auf der App kann ein Secret direkt auf
Azure Key Vault verweisen, ohne den Wert je zu materialisieren.

Die [Container-Apps-Dokumentation](https://learn.microsoft.com/azure/container-apps/overview)
beschreibt Ingress, Dapr und die Health-Probes (`liveness`/`readiness`), die für einen
Produktions-Service eingerichtet werden müssen.

> Container Apps überträgt das Serverless-Modell auf Container: Man behält sein OCI-Image und sein
> `Dockerfile`, ohne einen Cluster zu verwalten. Scale-to-Zero und Traffic-Split werden von der
> Plattform bereitgestellt.
