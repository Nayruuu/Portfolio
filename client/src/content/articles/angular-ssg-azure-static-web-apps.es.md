Un SPA Angular clásico envía una página en blanco a los crawlers: mientras el JS no se haya ejecutado, no hay nada que indexar. La **generación de sitio estático** (SSG) resuelve esto prerenderizando cada ruta a HTML en el build. Combinada con **Azure Static Web Apps**, se obtiene un sitio sin servidor que hospedar. Cada página se entrega como HTML completo, ya indexable.

## Prerender nativo, sin servidor Node

Desde `@angular/ssr`, el modo `outputMode: 'static'` prerenderiza **todas las rutas** en
la compilación y solo emite archivos estáticos, sin ningún servidor Node que hospedar. Esto
es lo que hace trivial el despliegue en Azure SWA: se sube una carpeta `browser/`.

```yaml
# angular.json — build target excerpt
"outputMode": "static",
"prerender": true,
"ssr": {
  "entry": "src/server.ts"
}
```

### La trampa de las rutas parametrizadas

Una ruta padre `:lang` con un `redirectTo` funcional **rompe** el prerenderizado: el
`<router-outlet>` queda vacío. La solución es exponer dos árboles estáticos explícitos
(`/fr` y `/en`) en lugar de un parámetro. El idioma se convierte en un prefijo de URL, no en
un param.

## Configurar Azure Static Web Apps

Azure SWA lee un archivo `staticwebapp.config.json` en la raíz del despliegue. El fallback
SPA es esencial ahí para que el routing del cliente tome el relevo en las rutas no
prerenderizadas, sin devolver un 404.

```yaml
# staticwebapp.config.json (equivalente)
navigationFallback:
  rewrite: /index.html
  exclude:
    - /assets/*
    - /*.{css,js,png,svg}
mimeTypes:
  .json: application/json
```

## SEO completo en la compilación

Un script post-build genera `sitemap.xml`, `robots.txt` y `llms.txt`, mientras que el
`SeoService` coloca los `<title>`, etiquetas **Open Graph**, `canonical`, `hreflang` y el
JSON-LD `BlogPosting` ruta por ruta.

Como todo está en el HTML prerenderizado, crawlers e IA obtienen el contenido **sin ejecutar
una sola línea de JS**. La documentación de Azure detalla la configuración en la guía
[Static Web Apps configuration](https://learn.microsoft.com/azure/static-web-apps/configuration).

> El SSG hace más que SEO: la página se muestra incluso antes de que el JS se haya
> descargado. El **time-to-content** se vuelve independiente de la conexión del visitante.
