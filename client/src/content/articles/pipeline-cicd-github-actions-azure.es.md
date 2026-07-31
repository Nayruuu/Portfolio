Un despliegue manual nunca es dos veces igual. Un pipeline **CI/CD** en
GitHub Actions elimina esta variable: cada `git push` se convierte en un build probado, y luego en un
despliegue reproducible hacia Azure, sin tener que tocar nunca un portal.

## Un workflow declarativo

Todo vive en `.github/workflows/`. Un workflow se dispara ante un evento (`push`,
`pull_request`), encadena **jobs**, y cada job es una sucesión de `steps`:

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

### La autenticación por OIDC

En lugar de un secreto de larga duración copiado en GitHub, se utiliza la **federated identity**
(OIDC): Azure confía en el token efímero que GitHub emite para ese repositorio. Así, no
hay ninguna clave que rotar, y nada que pueda filtrarse.

```yaml
permissions:
  id-token: write
  contents: read
```

## Desplegar hacia Azure

Una vez generado el artefacto del build, la acción oficial empuja la carpeta estática hacia Azure
Static Web Apps (o App Service para una API .NET):

- `azure/login@v2` con las credenciales federadas
- `Azure/static-web-apps-deploy@v1` para el front prerenderizado
- un paso de smoke test que hace `curl` a la URL de producción justo después

## Salvaguardas

Un pipeline que despliega solo necesita límites explícitos. Se protege la rama `main`
(revisión obligatoria, CI en verde requerida) y se coloca el despliegue detrás de un **Environment**
de GitHub con **required reviewers** para producción. La documentación de
[environments de GitHub](https://docs.github.com/actions/deployment/targeting-different-environments)
detalla las aprobaciones manuales.

> Un buen pipeline se mide por la **confianza** que se le otorga, no por su velocidad: suficiente
> como para desplegar un martes a las 17 h sin reunión de crisis.
