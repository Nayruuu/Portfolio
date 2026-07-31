El eclipse solar del 12 de agosto de 2026 será total en Islandia y luego en España; en Francia, la
ocultación superará el 92 % en París y el 99 % en Biarritz.

Universe Map, un prototipo **Angular 21** + **Three.js r185**, recalcula este evento por completo
en el navegador: sombra y penumbra proyectadas sobre el globo, trayectoria de la totalidad, vistas
desde el suelo, catálogo local de los próximos eclipses, y un punto central verificado contra los
elementos de Bessel publicados por la NASA.

Sin embargo, el eclipse no es más que un módulo. El proyecto es un mapa 3D continuo del Universo,
al estilo de Google Maps: desde el suelo de un planeta hasta el Grupo Local, sin backend ni base
de datos, y sin petición de red para los cálculos.

## Un zoom continuo sobre cinco órdenes de magnitud

La navegación no es una colección de escenas de planetario. La rueda del ratón despliega un
trayecto logarítmico a través de cinco escalas (planetaria, Sistema Solar, estelar, galáctica,
Grupo Local), la cámara conserva su anclaje espacial, y el trayecto es reversible: alejarse desde
la Tierra hasta el Grupo Local y luego volver restituye exactamente el encuadre inicial.

El motor Three.js vive en una carpeta `engine/` sin dependencia de los componentes Angular: la
aplicación se suscribe a una fachada de eventos tipados, el bucle de renderizado se ejecuta fuera
de la detección de cambios, y los cálculos orbitales están limitados a 12 Hz cuando el renderizado
no lo está.

Bajo el mapa, referencias jerárquicas: cada objeto se posiciona en relación con su padre (la Luna
bajo la Tierra, la Tierra bajo el Sol, el Sol dentro de la Vía Láctea), las unidades científicas
permanecen en los datos fuente, y cada escala aplica su propia compresión de distancias para
seguir siendo navegable.

Queda el problema de las grandes coordenadas: una GPU calcula en `float32`, y a pocos miles de
unidades del origen la geometría empieza a temblar. De ahí un *floating origin* que recentra el
mundo sobre el objetivo de la cámara antes de que la precisión se degrade:

```typescript
// recenter the world on the camera target before float32 precision degrades
update(spaceRoot: THREE.Group, camera: THREE.Camera, target: THREE.Vector3): boolean {
  if (target.length() < this.threshold) { return false; }

  const shift = target.clone();
  spaceRoot.position.sub(shift);
  camera.position.sub(shift);
  target.sub(shift);
  this.accumulatedOrigin.add(shift); // absolute position = local + accumulated origin

  return true;
}
```

## 10 000 estrellas, una sola draw call

El campo estelar proviene de la [HYG Database v4.1](https://github.com/astronexus/HYG-Database)
(CC BY-SA 4.0): las **10 000** entradas válidas más brillantes fuera del Sol, época J2000,
convertidas en un binario de unos **782 KiB** donde las coordenadas permanecen en pársecs.

El parser valida firma, versión, sistema de referencia y cadenas UTF-8 antes de exponer arrays
tipados al renderizado, y la importación se reproduce desde el CSV de origen con un solo comando.

Del lado de la GPU, las 10 000 estrellas comparten un único `THREE.Points` y una única
`BufferGeometry`: una sola draw call, en todas las escalas y en todos los niveles de calidad.
Seleccionar una estrella no crea ningún objeto: un único grupo de detalle reutilizable se
reposiciona sobre ella, pasa de punto a halo en pantalla y luego a una esfera emisiva al
acercarse, mientras las otras 9 999 permanecen en el batch.

Cada entrada es buscable por nombre o por designación HYG, HIP, HD, HR, Gliese, Bayer y
Flamsteed.

## El tiempo es una coordenada

El tiempo interno es un día juliano; `Date` solo existe en la frontera de la interfaz. Las
posiciones del Sol, la Luna y los ocho planetas provienen de
[Astronomy Engine](https://github.com/cosinekitty/astronomy), ejecutado localmente: sus modelos
VSOP87 compactos y lunares están validados previamente contra NOVAS y JPL Horizons.

Los ejes de rotación y meridianos de origen siguen los
[elementos rotacionales IAU 2015](https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf),
dependientes de la fecha: Venus y Urano giran en retrógrado, y los anillos de Saturno heredan el
plano ecuatorial del planeta en lugar de una inclinación decorativa.

La línea temporal es editable en UTC con ocho velocidades de simulación; la rotación terrestre
permanece astronómicamente exacta hasta una hora simulada por segundo real, y luego se limita a
una vuelta cada 24 segundos reales para seguir siendo legible, mientras las fechas y posiciones
orbitales continúan a la velocidad solicitada.

## El motor de eclipses

Los cálculos de sombra utilizan los radios y distancias físicas antes de cualquier proyección
sobre las esferas visualmente adaptadas del mapa, y el eje de sombra solar se interseca con un
geoide terrestre achatado en el sistema de referencia ecuatorial de la fecha.

Durante un eclipse solar, la sombra y penumbra lunares se renderizan sobre la Tierra; durante un
eclipse lunar, la sombra terrestre se dibuja sobre la Luna. Las capas orbitales superpuestas
(penumbra cian, totalidad coral, anularidad dorada) asumen un tamaño visual mínimo documentado: a
la escala del globo, la sombra física sería casi invisible.

Las vistas desde el suelo recalculan la proporción aparente de los discos lunar y solar desde la
posición del observador, para que un eclipse anular nunca se represente como total:

```typescript
function calculateSolarApparentDiscRatio(sunDistance: number, moonDistance: number): number {
  const sunAngularRadius = Math.asin(Math.min(1, SUN_RADIUS_AU / sunDistance));
  const moonAngularRadius = Math.asin(Math.min(1, MOON_RADIUS_AU / moonDistance));

  return sunAngularRadius === 0 ? 1 : moonAngularRadius / sunAngularRadius; // < 1 → annular
}
```

Un catálogo local calcula los próximos eclipses terrestres en el navegador y distingue el máximo
global del máximo observable en diez ciudades francesas, con hora UTC, hora local, ocultación y
altura del Sol.

## Contrastado con los valores publicados

Un renderizado de sombra puede ser plausible y falso. La validación pasa, por tanto, por las
referencias.

Las pruebas clasifican el 12 de agosto de 2026 como total y el 6 de febrero de 2027 como anular,
y verifican las ocultaciones locales (**92,03 %** en París, **99,41 %** en Biarritz) contra las
circunstancias publicadas. También encuentran en el geoide el punto central del máximo, comparado
con los
[elementos de Bessel del NASA GSFC](https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html):

```typescript
// greatest eclipse of 2026-08-12 — central point vs published Besselian elements
expect(appearance.centralLatitude).toBeCloseTo(65.216, 3);
expect(appearance.centralLongitude).toBeCloseTo(-25.249, 3);
```

El prototipo se sostiene con **442 pruebas** unitarias y de integración, una cobertura del
**100 %** (instrucciones, ramas, funciones, líneas) sobre el código de producción, un gate
individual por módulo científico y **25 recorridos Playwright** de escritorio y móvil. La
cobertura impide las regresiones; la validez científica, en cambio, se verifica contra valores de
referencia, invariantes y casos degenerados.

## Decir qué se mide y qué se dibuja

Cada objeto declara un nivel de confianza entre seis posibles: `observed`, `calculated`,
`extrapolated`, `simulated`, `procedural`, `illustrative`. Las adaptaciones necesarias para la
legibilidad (radios exagerados, distancia Tierra-Luna amplificada, Vía Láctea procedural) se
identifican en la interfaz en lugar de pasarse por alto.

Las posiciones del Grupo Local provienen del catálogo de
[McConnachie 2012](https://www.astro.uvic.ca/~alan/Nearby_Dwarf_Database_files/mcconnachie2012.pdf),
la textura terrestre del
[Blue Marble](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/)
de la NASA, y el modelo de efemérides se presenta por lo que es: visualización pedagógica, no
navegación espacial.

Universe Map está en la versión v0.1.0, un prototipo funcional que por ahora se ejecuta en local;
el código aún no se ha publicado. El siguiente paso ya está definido: teselas estelares estáticas
cargadas en workers, circunstancias locales para un lugar arbitrario con las horas de contacto, y
la vista «Observable» (ya presente en la interfaz, todavía en modo simultáneo) que aplicará el
retraso físico de la luz.

> Una visualización científica vale lo que valen sus puntos de control. Aquí, el mismo cálculo
> alimenta la sombra renderizada sobre el globo y el catálogo de eclipses, y reproduce con tres
> decimales de precisión el punto central publicado para el 12 de agosto de 2026. El resto del
> mapa declara su nivel de confianza en lugar de dejarlo a la imaginación.
