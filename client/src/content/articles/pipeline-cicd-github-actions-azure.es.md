Desplegar manualmente es desplegar un viernes por la noche con el estómago encogido. Un pipeline
**CI/CD** en GitHub Actions transforma cada `git push` en una build testeada y luego en un
despliegue reproducible hacia Azure — sin tocar jamás un portal.

## Un workflow declarativo

Todo vive en `.github/workflows/`. Un workflow se dispara con un evento (`push`,
`pull_request`), encadena **jobs**, y cada job es una serie de `steps`:

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

### Secretos sin secretos: OIDC

En lugar de un secreto de larga duración copiado en GitHub, se utiliza la **federated identity**
(OIDC): Azure confía en el token efímero que GitHub emite para ese repositorio. Ninguna clave que
rotar, nada que filtrar.

```yaml
permissions:
  id-token: write
  contents: read
```

## Desplegar hacia Azure

Una vez artefactada la build, la acción oficial empuja la carpeta estática hacia Azure
Static Web Apps (o App Service para una API .NET):

- `azure/login@v2` con las credenciales federadas
- `Azure/static-web-apps-deploy@v1` para el front prerenderizado
- un paso de smoke test que hace `curl` a la URL de prod justo después

## Salvaguardas

Un pipeline que despliega sin red es una pistola cargada. Se protege la rama `main`
(revisión obligatoria, CI verde requerida) y se sitúa el despliegue detrás de un **Environment**
de GitHub con **required reviewers** para producción. La documentación de los
[environments de GitHub](https://docs.github.com/actions/deployment/targeting-different-environments)
detalla las aprobaciones manuales.

> Un buen pipeline no es el que despliega más rápido, sino aquel en el que se tiene **suficiente
> confianza** para desplegar un martes a las 17 h sin reunión de crisis.
