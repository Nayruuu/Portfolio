Provisionner un cluster Kubernetes pour héberger une seule API, c'est sortir l'artillerie
lourde pour une mouche. **Azure Container Apps** offre le serverless conteneurisé : on pousse
une image, la plateforme gère l'orchestration, le scaling — jusqu'à **zéro** — et le routage,
le tout sans jamais écrire un manifeste Kubernetes.

## Déployer une image en une commande

Container Apps s'appuie sur un **environment** (la frontière réseau et de logs partagée par
plusieurs apps) puis sur des apps individuelles. La CLI `az containerapp up` fait tout le
travail de bootstrap au premier déploiement :

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

Le `--target-port 8080` doit correspondre au port que **Kestrel** écoute dans le conteneur
(`ASPNETCORE_URLS=http://+:8080`). L'ingress `external` expose un FQDN HTTPS public avec
certificat géré ; `internal` réserve l'app au trafic intra-environment, idéal pour un service
appelé seulement par d'autres apps.

## Scale-to-zero et règles KEDA

L'argument économique décisif : avec `--min-replicas 0`, une app inactive **ne coûte rien**.
À la première requête, la plateforme démarre un réplica (cold start de quelques centaines de
millisecondes). Le scaling repose sur **KEDA** : on déclare des règles sur des métriques, pas
seulement sur le CPU.

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

Ici un nouveau réplica est ajouté par tranche de 50 requêtes concurrentes. Pour un worker
consommant une file, on utilise un scaler `azure-servicebus` ou `azure-queue` : l'app dort
tant que la file est vide, puis monte en charge selon la profondeur de la queue. Le
[catalogue des scalers KEDA](https://keda.sh/docs/latest/scalers/) couvre Kafka, Redis,
Prometheus et bien d'autres.

## Révisions et traffic split

Chaque modification de la **configuration de conteneur** (image, variables, ressources) crée
une nouvelle **révision** immuable. En mode `multiple`, plusieurs révisions tournent en
parallèle et on répartit le trafic — la base d'un déploiement canary ou blue-green.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

On envoie ici **10 %** du trafic vers la nouvelle révision. Si les métriques tiennent, on
bascule à `100`, sinon on revient à `0` instantanément — sans redéployer. C'est un rollback
qui se mesure en secondes.

## Gérer la configuration proprement

Les variables d'environnement sensibles passent par des **secrets** d'app, référencés via la
syntaxe `secretref:`. Mieux : activez l'**identité managée** sur l'app et faites pointer un
secret directement vers Azure Key Vault, sans jamais matérialiser la valeur. La
[documentation Container Apps](https://learn.microsoft.com/azure/container-apps/overview)
détaille ingress, Dapr et les sondes de santé (`liveness`/`readiness`) à câbler pour un
service de production.

> Container Apps, c'est le serverless sans renoncer aux conteneurs : on garde son image OCI
> et son `Dockerfile`, mais on **oublie le cluster**. Scale-to-zero et traffic split offerts.
