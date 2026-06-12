## Prerender nativo, sin servidor Node

Desde `@angular/ssr`, el modo `outputMode: 'static'` prerenderiza **todas las rutas** en la compilación y solo emite archivos estáticos — ningún servidor Node que alojar. Esto es lo que hace trivial el despliegue en Azure SWA: se sube una carpeta `browser/`.

```yaml
# angular.json — extrait de la cible de build
"outputMode": "static",
"prerender": true,
"ssr": {
  "entry": "src/server.ts"
}
```

### La trampa de las rutas parametrizadas

Una ruta padre `:lang` con un `redirectTo` funcional **rompe** el prerender: el `<router-outlet>` aparece vacío. La solución es exponer dos árboles estáticos explícitos (`/fr` y `/en`) en lugar de un parámetro. El idioma se convierte en un prefijo de URL, no en un param.

## Configurar Azure Static Web Apps

Azure SWA lee un archivo `staticwebapp.config.json` en la raíz del despliegue. El fallback SPA es esencial para que el routing del cliente tome el relevo en las rutas no prerenderizadas, sin devolver un 404.

```yaml
# staticwebapp.config.json (équivalent)
navigationFallback:
  rewrite: /index.html
  exclude:
    - /assets/*
    - /*.{css,js,png,svg}
mimeTypes:
  .json: application/json
```

## SEO completo en la compilación

Un script post-build genera `sitemap.xml`, `robots.txt` y `llms.txt`, mientras que el `SeoService` establece los `<title>`, etiquetas **Open Graph**, `canonical`, `hreflang` y el JSON-LD `BlogPosting` ruta por ruta. Como todo está en el HTML prerenderizado, los crawlers y las IAs recuperan el contenido **sin ejecutar una sola línea de JS**. La documentación de Azure detalla la configuración en la guía [Static Web Apps configuration](https://learn.microsoft.com/azure/static-web-apps/configuration).

> El SSG no es solo una optimización SEO: es un sitio que se muestra antes incluso de que el JS se haya descargado. El **time-to-content** se vuelve independiente de la conexión del visitante.
