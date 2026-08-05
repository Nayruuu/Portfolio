Provisionner un cluster Kubernetes pour héberger une seule API .NET, c'est administrer un
orchestrateur complet pour un besoin qui tient sur quelques conteneurs. **Azure Container Apps**
(ACA) occupe l'intermédiaire : du serverless conteneurisé. On pousse une image OCI, la plateforme
gère l'orchestration, le scaling jusqu'à **zéro** réplica et le routage HTTP, sans qu'on écrive le
moindre manifeste Kubernetes. En interne ACA repose sur AKS, KEDA, Dapr et Envoy, mais ces briques
restent hors de vue.

## L'environment, la frontière partagée

Tout part d'un **environment** : la frontière que plusieurs apps ont en commun. Les apps d'un même
environment partagent un réseau virtuel et écrivent leurs logs dans le même workspace Log
Analytics. C'est aussi le niveau où se déclarent les composants Dapr et les certificats.

On le crée une fois avec `az containerapp env create --name env-super-dev --resource-group
rg-super-dev --location westeurope`, puis on y attache autant d'apps que nécessaire.

Un environment se décline en **profils de charge**. Le profil Consumption facture à la seconde le
vCPU et la mémoire réellement alloués, et il autorise le scale-to-zero. Le profil Dedicated réserve
du compute, utile pour des besoins mémoire élevés ou une isolation plus stricte, mais ne descend
jamais à zéro. Pour une API classique, Consumption est le défaut raisonnable.

## Déployer une image en une commande

La CLI `az containerapp up` fait tout le bootstrap au premier déploiement : elle récupère l'image,
crée l'app dans l'environment et renvoie son FQDN.

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

Le `--target-port 8080` doit correspondre au port que **Kestrel** écoute dans le conteneur, ce
qu'on fixe côté `Dockerfile` avec `ASPNETCORE_URLS=http://+:8080`. La plateforme termine HTTPS en
amont : le conteneur parle HTTP en clair sur son port, ACA se charge du TLS. Inutile donc de gérer
un certificat dans Kestrel.

## Ingress et domaines personnalisés

L'ingress `external` publie un FQDN public en HTTPS avec certificat géré par la plateforme.
L'ingress `internal` réserve l'app au trafic intra-environment : c'est le bon réglage pour un
service appelé seulement par d'autres apps du même réseau. On choisit aussi le transport (HTTP,
HTTP/2 ou TCP) et le port exposé.

Pour un vrai nom de domaine, on ajoute le hostname puis on le lie à un certificat, via
`az containerapp hostname add` suivi de `az containerapp hostname bind`. ACA sait émettre un
**certificat managé gratuit** une fois l'enregistrement DNS de validation en place, ou accepter un
certificat que vous fournissez.

Les étapes exactes sont dans la
[documentation des domaines personnalisés](https://learn.microsoft.com/azure/container-apps/custom-domains-managed-certificates).

## Scale-to-zero et règles KEDA

L'argument économique tient en une ligne : avec `--min-replicas 0`, une app inactive ne consomme
aucun compute et ne coûte donc rien à ce titre. À la première requête, la plateforme démarre un
réplica ; ce réveil ajoute une latence de démarrage à froid dont l'ampleur dépend surtout de la
taille de l'image et du temps d'initialisation de l'app.

Le scaling repose sur **KEDA** : on déclare des règles sur des métriques, pas seulement sur le CPU.

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

Ici un réplica est ajouté par tranche de 50 requêtes concurrentes. Pour un worker qui consomme une
file, on branche plutôt un scaler `azure-servicebus` ou `azure-queue` : l'app dort tant que la file
est vide, puis monte en charge selon la profondeur de la queue, et redescend à zéro une fois le
backlog absorbé.

Un détail à connaître : les scalers CPU et mémoire imposent un minimum d'un réplica, donc ils
excluent le scale-to-zero. Le [catalogue des scalers KEDA](https://keda.sh/docs/latest/scalers/)
couvre Kafka, Redis, Prometheus et beaucoup d'autres sources.

## Révisions et bascule de trafic

Chaque modification de la **configuration de conteneur** (image, variables, ressources) crée une
nouvelle **révision** immuable. En mode `single`, seule la dernière révision reçoit du trafic. En
mode `multiple`, plusieurs révisions tournent en parallèle et on répartit le trafic entre elles :
c'est la base d'un déploiement canary ou blue/green.

```bash
az containerapp ingress traffic set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --revision-weight api-super-dev--rev3=90 api-super-dev--rev4=10
```

On envoie ici 10 % du trafic vers la nouvelle révision. Si les métriques tiennent, on passe le
poids à `100` ; sinon on le remet à `0` instantanément, sans redéployer quoi que ce soit. Le
rollback se mesure en secondes parce que l'ancienne révision est toujours là, chaude, prête à
reprendre la totalité du trafic.

## Secrets, variables et identité managée

Les variables d'environnement sensibles passent par des **secrets** définis au niveau de l'app,
référencés dans les variables via la syntaxe `secretref:`. La valeur n'apparaît jamais en clair
dans la configuration de la révision.

Avec une **identité managée** activée sur l'app, un secret peut pointer directement vers Azure Key
Vault : c'est ACA qui lit la valeur au démarrage, en s'authentifiant avec l'identité, sans jamais
matérialiser le secret dans l'app.

```bash
az containerapp secret set \
  --name api-super-dev \
  --resource-group rg-super-dev \
  --secrets "db-conn=keyvaultref:https://kv-super-dev.vault.azure.net/secrets/db-conn,identityref:/subscriptions/.../userAssignedIdentities/id-super-dev"
```

L'identité doit avoir le droit de lecture sur le coffre (rôle `Key Vault Secrets User` en RBAC, ou
une access policy). La même identité sert aussi à tirer l'image depuis un registre privé comme ACR,
ce qui évite de stocker un mot de passe de registre.

## Le sidecar Dapr, quand il aide

Container Apps intègre **Dapr** en option. Activé par app avec `--enable-dapr --dapr-app-id api
--dapr-app-port 8080`, il ajoute un conteneur sidecar qui expose les building blocks Dapr : appels
service-à-service, pub/sub, state store, secret store. Les composants (une file Service Bus pour le
pub/sub, un Cosmos DB pour l'état) se déclarent au niveau de l'environment et se limitent aux apps
autorisées.

Dapr n'est justifié que si vous adoptez son modèle. Pour une API HTTP qui parle à une base de
données et rien d'autre, le sidecar est un poids mort : laissez-le désactivé. Il devient
intéressant dès qu'il y a plusieurs services qui échangent des messages et partagent de l'état.

## Container Apps, App Service ou AKS

ACA se situe entre deux options plus anciennes. **App Service** reste le choix le plus simple pour
une application web ou une API unique : pas de notion de révision multiple ni de scaler à
configurer, et un modèle mental de PaaS très direct. Il montre ses limites dès qu'on veut plusieurs
conteneurs qui collaborent, du scale piloté par une file, ou le scale-to-zero.

**AKS** est l'autre extrême : Kubernetes complet, contrôle total sur le réseau, les node pools, les
contrôleurs et les CRD. Ce contrôle a un coût d'exploitation réel (mises à niveau du cluster,
capacité, sécurité). On le choisit quand on a besoin des API Kubernetes elles-mêmes ou d'un
existant k8s à réutiliser.

Container Apps vise le milieu : des microservices conteneurisés, du scaling événementiel et du
blue/green, sans cluster à administrer. Si votre besoin tient dans ce cadre, c'est souvent le bon
compromis ; la [documentation officielle](https://learn.microsoft.com/azure/container-apps/overview)
détaille ingress, sondes de santé et quotas pour un service de production.

> Container Apps applique le modèle serverless aux conteneurs : on garde son image OCI et son
> `Dockerfile`, sans gérer de cluster. Le scale-to-zero, les révisions et la bascule de trafic sont
> fournis par la plateforme, et l'identité managée relie l'app à Key Vault sans secret en clair.
