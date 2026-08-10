Ce dépôt se déploie sur Azure sans que quiconque ouvre le portail ou tape une commande `az`
à la main. Deux fichiers YAML dans `.github/workflows/` font tout le travail : l'un publie le
front statique, l'autre l'API .NET. Un `git push` sur `main` déclenche celui qui correspond aux
fichiers touchés, et lui seul.

## Deux workflows, deux déclencheurs

`deploy-client.yml` et `deploy-api.yml` partagent la même forme et rien de plus. Chacun écoute
`push` sur `main` et `workflow_dispatch` (le bouton manuel de l'onglet Actions), avec un filtre
de chemins qui le cantonne à son territoire :

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths: [client/**]
```

Corriger une faute dans un article ne relance donc pas le déploiement de l'API, et un changement
de code C# ne reconstruit pas le front. Deux domaines qui bougent à des rythmes différents
méritent des pipelines séparés.

Le filtre a une limite connue. Sur un force-push, GitHub peut voir tous les fichiers comme
modifiés et relancer le déploiement client alors que seule l'API a bougé. C'est sans conséquence
ici : reconstruire le même site statique et le repousser est idempotent.

## L'accès à Azure sans secret stocké

Aucun des deux workflows ne range de mot de passe Azure. L'authentification passe par OIDC
(federated identity) : Azure fait confiance à un jeton court émis par GitHub pour ce dépôt
précis, le temps du job. Le workflow demande la permission d'émettre ce jeton, puis se connecte
avec trois identifiants qui ne sont pas des secrets au sens fort (un client ID, un tenant, un
abonnement) :

```yaml
permissions:
  id-token: write # Azure OIDC login
  contents: read

steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - name: Azure Login via OIDC
    uses: azure/login@532459ea530d8321f2fb9bb10d1e0bcf23869a43 # v3.0.0
    with:
      client-id: ${{ secrets.AZURE_CLIENT_ID }}
      tenant-id: ${{ secrets.AZURE_TENANT_ID }}
      subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

`AZURE_CLIENT_ID`, `AZURE_TENANT_ID` et `AZURE_SUBSCRIPTION_ID` désignent l'application et
l'abonnement ; seuls, ils n'ouvrent rien. La confiance est déclarée côté Azure, dans un federated
credential qui n'accepte que les jetons portant l'identité de ce dépôt et de sa branche. Il n'y a
aucune clé à faire tourner ni à voir fuiter dans un log.

Un détail qui compte : chaque action est épinglée à un SHA de commit complet, la version lisible
en commentaire. `@v3` suivrait un tag mobile qu'un attaquant pourrait déplacer sous nos pieds ;
le SHA fige exactement le code exécuté.

## Le front : compiler, puis pousser du statique

Le runner part sur du prévisible : `actions/setup-node` en Node 22, avec le cache npm indexé sur
`client/package-lock.json`, puis `npm ci` plutôt que `npm install`. `ci` installe exactement ce
que le lockfile décrit, sans jamais le réécrire ; deux exécutions à un mois d'écart posent le même
arbre de dépendances.

Le job client se résume ensuite à construire le site et à en livrer le dossier. La construction
tient dans un seul script, `npm run build:ssg`, qui dérive d'abord les temps de lecture depuis le
nombre réel de mots, lance le build de production (Angular prérend chaque route en HTML statique),
génère sitemap et robots, puis exécute un garde-fou : `check-prerender.mjs` échoue si une page
d'article a perdu son JSON-LD ou son corps Markdown rendu.

C'est le seul contrôle du pipeline front, et il suffit pour ce qu'on déploie. Une compilation
TypeScript stricte qui casse, ou un article qui n'apparaît plus dans le HTML prérendu, arrête le
job avant tout déploiement. La suite Vitest et Playwright, elle, tourne en local avant le merge,
pas dans ce workflow.

Une fois `dist/super-dev-portfolio/browser` prêt, il faut le pousser vers le Static Web App. Le
jeton de déploiement n'est pas stocké non plus : on le récupère à l'exécution, via la connexion
OIDC déjà établie.

```yaml
# SWA deploy token fetched at runtime via OIDC, never stored as a secret.
- name: Fetch SWA deployment token
  run: |
    TOKEN=$(az staticwebapp secrets list \
      --name swa-sd-web \
      --resource-group rg-infra-web \
      --query "properties.apiKey" -o tsv)
    echo "SWA_TOKEN=$TOKEN" >> $GITHUB_ENV

- name: Deploy with SWA CLI
  working-directory: client
  run: |
    swa deploy dist/super-dev-portfolio/browser \
      --deployment-token "$SWA_TOKEN" \
      --env production
```

L'appli est ciblée par son nom (`swa-sd-web` dans `rg-infra-web`) ; le workflow ne crée aucune
ressource, il déploie dans une infrastructure qui existe déjà. Dernière étape, placée après le
déploiement pour que le fichier de clé soit en ligne quand les moteurs le valident : un ping
IndexNow qui prévient Bing et les moteurs qui suivent le protocole. Il est non bloquant par choix,
un indice de crawl raté ne devant jamais faire échouer un déploiement déjà réussi.

## L'API : tester avant de publier

Le job API a une étape que le front n'a pas : il exécute ses tests dans le pipeline, et refuse de
publier si l'un d'eux tombe.

```yaml
jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    environment: api # gated GitHub environment

    steps:
      - name: Test
        run: dotnet test api --configuration Release
      - name: Publish
        run: dotnet publish $PROJECT --configuration Release --output $PUBLISH_DIR
      - name: Deploy to Azure Functions
        uses: Azure/functions-action@v1
        with:
          app-name: afu-sd-api
          package: ${{ env.PUBLISH_DIR }}
```

`dotnet test` sur toute la solution passe avant `dotnet publish`. Un test rouge s'arrête là, avant
publication. Le binaire (worker isolé .NET 10) part ensuite en zip-deploy vers `afu-sd-api`, une
Function App en plan Flex Consumption, via l'action officielle `Azure/functions-action`.

La différence avec le front n'est pas un oubli. Un site statique se prouve en le compilant ;
pour une API, il faut exécuter son comportement, donc des tests à l'intérieur du pipeline.

## Les garde-fous

Un pipeline qui déploie tout seul mérite des limites explicites, et elles sont peu nombreuses ici.
La branche `main` est protégée : le code arrive par pull request, jamais en push direct. Le filtre
de chemins borne le rayon d'action de chaque workflow. Le build échoue avant le déploiement, jamais
après.

Et le job API tourne dans un Environment GitHub nommé `api`, quand le front n'en a pas. Un
Environment est l'endroit où l'on accroche les règles de protection (revue obligatoire, délai
d'attente, secrets réservés) avant qu'un job puisse s'y déployer. Mettre l'API derrière l'un et
laisser le front sans en traduit une asymétrie de risque assumée.

Ce que ces workflows ne font pas compte autant. Ils ne provisionnent rien. Le Static Web App, la
Function App, le stockage, la supervision et le budget vivent dans un dépôt Terraform séparé et
privé. Les pipelines déploient du code vers des ressources nommées ; ils n'ont pas le droit d'en
créer. La frontière entre déployer une application et fabriquer son infrastructure reste nette,
et c'est elle qui rend chaque `push` lisible.

> Le pipeline tient en deux fichiers courts, sans secret stocké et sans étape manuelle. C'est
> assez pour qu'un push le mardi après-midi parte en production sans cérémonie.
