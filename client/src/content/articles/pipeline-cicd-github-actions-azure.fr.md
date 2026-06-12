Déployer à la main, c'est déployer le vendredi soir avec la peur au ventre. Un pipeline
**CI/CD** sur GitHub Actions transforme chaque `git push` en build testé, puis en
déploiement reproductible vers Azure — sans jamais toucher à un portail.

## Un workflow déclaratif

Tout vit dans `.github/workflows/`. Un workflow se déclenche sur un événement (`push`,
`pull_request`), enchaîne des **jobs**, et chaque job est une suite de `steps` :

```yaml
name: deploy
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
      - run: npm run build:ssg
```

### Des secrets sans secrets : OIDC

Plutôt qu'un secret de longue durée copié dans GitHub, on utilise le **federated identity**
(OIDC) : Azure fait confiance au token éphémère que GitHub émet pour ce dépôt. Aucune clé à
faire tourner, rien à fuiter.

```yaml
permissions:
  id-token: write
  contents: read
```

## Déployer vers Azure

Une fois le build artefacté, l'action officielle pousse le dossier statique vers Azure
Static Web Apps (ou App Service pour une API .NET) :

- `azure/login@v2` avec les identifiants fédérés
- `Azure/static-web-apps-deploy@v1` pour le front prerendu
- une étape de smoke test qui `curl` l'URL de prod juste après

## Garde-fous

Un pipeline qui déploie sans filet est un pistolet chargé. On protège la branche `main`
(revue obligatoire, CI verte requise) et on place le déploiement derrière un **Environment**
GitHub avec **required reviewers** pour la prod. La doc des
[environments GitHub](https://docs.github.com/actions/deployment/targeting-different-environments)
détaille les approbations manuelles.

> Un bon pipeline n'est pas celui qui déploie le plus vite, c'est celui en qui on a **assez
> confiance** pour déployer un mardi à 17 h sans réunion de crise.
