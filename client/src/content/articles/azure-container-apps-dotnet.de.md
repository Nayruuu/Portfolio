Provisionierung eines Kubernetes-Clusters, um eine einzige .NET-API zu hosten, bedeutet die Administration eines
kompletten Orchestrators für einen Bedarf, der auf wenige Container passt. **Azure Container Apps**
(ACA) besetzt die Mitte: containerisiertes Serverless. Man pusht ein OCI-Image, die Plattform
übernimmt die Orchestrierung, das Scaling bis auf **null** Replicas und das HTTP-Routing, ohne dass man
auch nur ein einziges Kubernetes-Manifest schreibt. Intern basiert ACA auf AKS, KEDA, Dapr und Envoy, aber diese
Bausteine bleiben außer Sichtweite.

## Die Environment, die gemeinsame Grenze

Alles beginnt mit einer **Environment**: der Grenze, die mehrere Apps gemeinsam haben. Die Apps einer
Environment teilen sich ein virtuelles Netzwerk und schreiben ihre Logs in denselben Log-Analytics-Workspace.
Auf dieser Ebene werden auch die Dapr-Komponenten und die Zertifikate deklariert.

Man erstellt sie einmalig mit `az containerapp env create --name env-super-dev --resource-group
rg-super-dev --location westeurope` und hängt anschließend so viele Apps an, wie nötig.

Eine Environment gliedert sich in **Workload-Profile**. Das Consumption-Profil rechnet vCPU und Speicher,
die tatsächlich zugewiesen wurden, sekundengenau ab und erlaubt Scale-to-Zero. Das Dedicated-Profil reserviert
Compute-Kapazität, nützlich bei hohem Speicherbedarf oder strengerer Isolation, skaliert aber nie
auf null herunter. Für eine klassische API ist Consumption die vernünftige Standardwahl.

## Ein Image mit einem einzigen Befehl deployen

Die CLI `az containerapp up` erledigt beim ersten Deployment das gesamte Bootstrapping: Sie holt das Image,
erstellt die App in der Environment und liefert deren FQDN zurück.

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

Der `--target-port 8080` muss dem Port entsprechen, auf den **Kestrel** im Container lauscht, was man
auf `Dockerfile`-Seite mit `ASPNETCORE_URLS=http://+:8080` festlegt. Die Plattform terminiert HTTPS vorgelagert:
Der Container spricht Klartext-HTTP auf seinem Port, ACA kümmert sich um TLS. Es ist daher nicht nötig, ein
Zertifikat in Kestrel zu verwalten.

## Ingress und benutzerdefinierte Domains

Der Ingress `external` veröffentlicht einen öffentlichen FQDN über HTTPS mit einem von der Plattform
verwalteten Zertifikat. Der Ingress `internal` beschränkt die App auf Traffic innerhalb der Environment: das
ist die richtige Einstellung für einen Service, der nur von anderen Apps im selben Netzwerk aufgerufen wird.
Man wählt außerdem den Transport (HTTP, HTTP/2 oder TCP) und den exponierten Port.

Für einen echten Domainnamen fügt man den Hostname hinzu und bindet ihn dann an ein Zertifikat, über
`az containerapp hostname add` gefolgt von `az containerapp hostname bind`. ACA kann ein kostenloses
**verwaltetes Zertifikat** ausstellen, sobald der DNS-Validierungseintrag vorhanden ist, oder ein
selbst bereitgestelltes Zertifikat akzeptieren.

Die genauen Schritte stehen in der
[Dokumentation zu benutzerdefinierten Domains](https://learn.microsoft.com/azure/container-apps/custom-domains-managed-certificates).

## Scale-to-Zero und KEDA-Regeln

Das wirtschaftliche Argument lässt sich in einem Satz zusammenfassen: Mit `--min-replicas 0` verbraucht eine
inaktive App keinerlei Compute und kostet folglich nichts in diesem Punkt. Bei der ersten Anfrage
startet die Plattform ein Replica; dieses Aufwachen fügt eine Cold-Start-Latenz hinzu, deren Ausmaß vor allem
von der Größe des Images und der Initialisierungszeit der App abhängt.

Das Scaling basiert auf **KEDA**: Man deklariert Regeln auf Basis von Metriken, nicht nur auf der CPU.

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

Hier wird pro 50 gleichzeitigen Requests ein Replica hinzugefügt. Für einen Worker, der eine Queue
konsumiert, schließt man stattdessen einen `azure-servicebus`- oder `azure-queue`-Scaler an: Die App
schläft, solange die Queue leer ist, skaliert dann je nach Queue-Tiefe hoch und fährt herunter
auf null, sobald der Backlog abgearbeitet ist.

Ein Detail, das man kennen sollte: Die CPU- und Memory-Scaler erzwingen ein Minimum von einem Replica, sie
schließen also Scale-to-Zero aus. Der [KEDA-Scaler-Katalog](https://keda.sh/docs/latest/scalers/)
deckt Kafka, Redis, Prometheus und viele weitere Quellen ab.

## Revisionen und Traffic-Umschaltung

Jede Änderung an der **Container-Konfiguration** (Image, Variablen, Ressourcen) erzeugt eine
neue, unveränderliche **Revision**. Im Modus `single` erhält nur die neueste Revision Traffic. Im
Modus `multiple` laufen mehrere Revisionen parallel, und der Traffic wird zwischen ihnen aufgeteilt:
das ist die Grundlage für ein Canary- oder Blue/Green-Deployment.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

Hier werden 10 % des Traffics an die neue Revision geschickt. Wenn die Metriken stimmen, setzt man das
Gewicht auf `100`; andernfalls setzt man es sofort auf `0` zurück, ohne irgendetwas neu deployen zu müssen. Das
Rollback dauert Sekunden, weil die alte Revision immer noch vorhanden, warmgelaufen und bereit ist,
den gesamten Traffic wieder zu übernehmen.

## Secrets, Variablen und Managed Identity

Sensible Umgebungsvariablen laufen über auf App-Ebene definierte **Secrets**, die in den
Variablen über die Syntax `secretref:` referenziert werden. Der Wert erscheint nie im Klartext
in der Konfiguration der Revision.

Mit einer auf der App aktivierten **Managed Identity** kann ein Secret direkt auf Azure Key
Vault verweisen: ACA liest den Wert beim Start, indem es sich mit der Identity authentifiziert, ohne dass das Secret
jemals in der App materialisiert wird.

```bash
az containerapp secret set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --secrets "db-conn=keyvaultref:https://kv-super-dev.vault.azure.net/secrets/db-conn,identityref:/subscriptions/.../userAssignedIdentities/id-super-dev"
```

Die Identity muss über das Leserecht auf den Vault verfügen (Rolle `Key Vault Secrets User` in RBAC, oder
eine Access Policy). Dieselbe Identity dient auch dazu, das Image aus einer privaten Registry wie ACR zu ziehen,
wodurch das Speichern eines Registry-Passworts entfällt.

## Der Dapr-Sidecar, wenn er hilft

Container Apps integriert **Dapr** optional. Pro App aktiviert mit `--enable-dapr --dapr-app-id api
--dapr-app-port 8080`, fügt er einen Sidecar-Container hinzu, der die Dapr-Building-Blocks bereitstellt:
Service-zu-Service-Aufrufe, Pub/Sub, State-Store, Secret-Store. Die Komponenten (eine Service-Bus-Queue
für Pub/Sub, eine Cosmos DB für den State) werden auf Environment-Ebene deklariert und auf die
autorisierten Apps beschränkt.

Dapr ist nur gerechtfertigt, wenn man sein Modell übernimmt. Für eine HTTP-API, die mit einer Datenbank
spricht und sonst nichts, ist der Sidecar totes Gewicht: Lassen Sie ihn deaktiviert. Interessant wird er erst,
wenn es mehrere Services gibt, die Nachrichten austauschen und sich State teilen.

## Container Apps, App Service oder AKS

ACA positioniert sich zwischen zwei älteren Optionen. **App Service** bleibt die einfachste Wahl für
eine Webanwendung oder eine einzelne API: kein Konzept mehrerer Revisionen, kein zu konfigurierender
Scaler, und ein sehr direktes PaaS-Mentalmodell. Es stößt an Grenzen, sobald man mehrere
zusammenarbeitende Container, ein von einer Queue gesteuertes Scaling oder Scale-to-Zero benötigt.

**AKS** ist das andere Extrem: vollständiges Kubernetes, volle Kontrolle über Netzwerk, Node-Pools,
Controller und CRDs. Diese Kontrolle hat einen realen Betriebsaufwand (Cluster-Upgrades,
Kapazität, Sicherheit). Man wählt es, wenn man die Kubernetes-APIs selbst benötigt oder ein
bestehendes k8s-Setup weiterverwenden will.

Container Apps zielt auf die Mitte: containerisierte Microservices, ereignisgesteuertes Scaling und
Blue/Green, ohne einen Cluster administrieren zu müssen. Wenn Ihr Bedarf in diesen Rahmen passt, ist das oft der richtige
Kompromiss; die [offizielle Dokumentation](https://learn.microsoft.com/azure/container-apps/overview)
behandelt Ingress, Health-Probes und Quotas für einen Produktionsservice im Detail.

> Container Apps wendet das Serverless-Modell auf Container an: Man behält sein OCI-Image und sein
> `Dockerfile`, ohne einen Cluster zu verwalten. Scale-to-Zero, Revisionen und Traffic-Umschaltung werden
> von der Plattform bereitgestellt, und die Managed Identity verbindet die App mit Key Vault, ohne Secrets im Klartext.
