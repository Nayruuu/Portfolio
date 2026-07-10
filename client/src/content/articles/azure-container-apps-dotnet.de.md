Einen Kubernetes-Cluster bereitzustellen, um eine einzige API zu hosten, heißt mit Kanonen auf Spatzen zu schießen. **Azure Container Apps** bietet serverlose Container: Man pusht ein Image, die Plattform übernimmt Orchestrierung, Scaling — bis auf **null** — und Routing, und das alles, ohne jemals ein Kubernetes-Manifest zu schreiben.

## Ein Image mit einem einzigen Befehl deployen

Container Apps basiert auf einer **Environment** (der gemeinsamen Netzwerk- und Log-Grenze mehrerer Apps) und darauf aufbauend auf einzelnen Apps. Die CLI `az containerapp up` übernimmt beim ersten Deployment die gesamte Bootstrap-Arbeit:

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

Der `--target-port 8080` muss mit dem Port übereinstimmen, auf dem **Kestrel** im Container lauscht (`ASPNETCORE_URLS=http://+:8080`). Der Ingress `external` stellt einen öffentlichen HTTPS-FQDN mit verwaltetem Zertifikat bereit; `internal` beschränkt die App auf intra-Environment-Traffic — ideal für einen Dienst, der nur von anderen Apps aufgerufen wird.

## Scale-to-zero und KEDA-Regeln

Das entscheidende wirtschaftliche Argument: Mit `--min-replicas 0` **kostet eine inaktive App nichts**. Bei der ersten Anfrage startet die Plattform ein Replikat (Cold Start von einigen hundert Millisekunden). Das Scaling basiert auf **KEDA**: Man deklariert Regeln auf Basis von Metriken, nicht nur der CPU.

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

Hier wird pro 50 gleichzeitiger Anfragen ein neues Replikat hinzugefügt. Für einen Worker, der eine Queue verarbeitet, verwendet man einen `azure-servicebus`- oder `azure-queue`-Scaler: Die App schläft, solange die Queue leer ist, und skaliert dann entsprechend der Queue-Tiefe. Der [KEDA-Scaler-Katalog](https://keda.sh/docs/latest/scalers/) deckt Kafka, Redis, Prometheus und viele weitere ab.

## Revisionen und Traffic-Split

Jede Änderung der **Container-Konfiguration** (Image, Variablen, Ressourcen) erzeugt eine neue unveränderliche **Revision**. Im Modus `multiple` laufen mehrere Revisionen parallel und der Traffic wird aufgeteilt — die Grundlage eines Canary- oder Blue-Green-Deployments.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

Hier werden **10 %** des Traffics an die neue Revision geleitet. Halten die Metriken stand, wechselt man auf `100`; andernfalls kehrt man sofort auf `0` zurück — ohne erneutes Deployment. Ein Rollback, der sich in Sekunden bemisst.

## Konfiguration sauber verwalten

Sensible Umgebungsvariablen werden über App-**Secrets** übergeben, referenziert über die Syntax `secretref:`. Noch besser: Aktivieren Sie die **verwaltete Identität** für die App und lassen Sie ein Secret direkt auf Azure Key Vault zeigen, ohne den Wert jemals zu materialisieren. Die [Container Apps-Dokumentation](https://learn.microsoft.com/azure/container-apps/overview) beschreibt Ingress, Dapr und die Gesundheitssonden (`liveness`/`readiness`), die für einen Produktionsdienst zu konfigurieren sind.

> Container Apps ist Serverless ohne Verzicht auf Container: Man behält sein OCI-Image und sein `Dockerfile`, aber **vergisst den Cluster**. Scale-to-zero und Traffic-Split inklusive.
