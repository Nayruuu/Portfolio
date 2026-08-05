El eclipse solar del 12 de agosto de 2026 será total sobre Islandia y luego el norte de España. En Francia,
la ocultación superará el 92 % en París y el 99 % en Biarritz.

Universe Map, un prototipo **Angular 21** + **Three.js r185**, recalcula este evento enteramente
en el navegador: sombra y penumbra proyectadas sobre el globo, línea de totalidad, vistas desde el
suelo, catálogo local de los próximos eclipses. El punto central del máximo se verifica contra los
elementos de Bessel publicados por la NASA.

El eclipse es solo un módulo. El proyecto es un mapa 3D continuo del Universo, desde el suelo de un
planeta hasta la red cósmica, sin backend, sin base de datos, y sin petición de red para los cálculos.

## Un zoom continuo en siete escalas

La navegación no es una colección de escenas de planetario. La rueda del ratón despliega un trayecto
a través de siete escalas, desde la vista planetaria hasta la red cósmica de Cosmicflows-4, pasando
por el Sistema Solar, el vecindario estelar, la Vía Láctea, el Grupo Local y el Universo cercano.

Las distancias de cámara asociadas a estas escalas van de 4,8 a 420 000 unidades de escena, es decir
casi cinco órdenes de magnitud, y la interpolación entre dos anclas es logarítmica. El trayecto es
reversible: alejarse desde la Tierra hasta la red cósmica y luego regresar restituye el encuadre de
partida.

El motor Three.js vive en una carpeta `engine/` sin dependencia de los componentes Angular.
La aplicación se suscribe a una fachada de eventos tipados, y el bucle de renderizado corre fuera de
la detección de cambios, con un delta acotado a 100 ms para absorber una pestaña que quedó en segundo
plano.

El renderizado sigue la frecuencia de la pantalla, pero no los cálculos pesados. El recálculo de las
posiciones orbitales y de la sombra está limitado a un paso cada 1/24 de segundo, es decir como máximo
24 Hz, y el evento `time-changed` difundido hacia la interfaz está limitado a uno cada 120 ms
aproximadamente.

Bajo el mapa, referencias jerárquicas: cada objeto se posiciona en relación con su padre, la Luna bajo
la Tierra, la Tierra bajo el Sol, el Sol en la Vía Láctea. Las unidades científicas permanecen en los
datos fuente, y cada escala aplica su propia compresión de distancias para seguir siendo navegable.

Queda el problema de las grandes coordenadas. Una GPU calcula en `float32`, y a pocos miles de
unidades del origen la geometría empieza a temblar. De ahí un *floating origin* que recentra el mundo
sobre el objetivo de la cámara en cuanto se aleja 1 600 unidades, antes de que la precisión se
degrade:

```typescript
// recenter the world on the camera target before float32 precision degrades
update(spaceRoot, camera, controlsTarget, transitionInProgress): boolean {
  if (transitionInProgress || controlsTarget.length() < this.threshold) {
    return false;
  }
  const shift = controlsTarget.clone();
  spaceRoot.position.sub(shift);
  camera.position.sub(shift);
  controlsTarget.sub(shift);
  this.accumulatedOrigin.add(shift); // absolute position = local + accumulated origin
  return true;
}
```

## 10 000 estrellas, una sola draw call

El campo estelar proviene de la [HYG Database v4.1](https://github.com/astronexus/HYG-Database)
(CC BY-SA 4.0). El preparador retiene las **10 000** entradas válidas más brillantes salvo el Sol,
hasta la magnitud aparente 13,45, en la época J2000. El resultado es un binario de
**801 224 bytes**, unos 782 KiB, donde las coordenadas permanecen en pársecs.

El formato es explícito: una cabecera de 40 bytes, registros de 36 bytes, una firma
`UMSC` en versión 2. El analizador valida la firma, la versión y el sistema de referencia (cartesiano
ecuatorial), y luego decodifica cada cadena con un `TextDecoder` en modo estricto. Rechaza un orden
por magnitud no creciente, un identificador HYG duplicado o una posición nula, y lanza un error en
lugar de exponer datos dudosos al renderizado.

En el lado de la GPU, las 10 000 estrellas comparten un único `THREE.Points` y una única
`BufferGeometry`. Una draw call, en todas las escalas y en todos los niveles de calidad. Seleccionar
una estrella no crea ningún objeto: capas persistentes se reposicionan sobre ella, del punto al halo
en pantalla y luego a una esfera con oscurecimiento centro-borde al acercarse, mientras las otras
9 999 permanecen en el batch.

Más allá de este lote compacto, un octree laxo pilotado por la cámara solo difunde las regiones
visibles de 640 y 320 pársecs, extraídas de 34 paquetes estáticos compartidos, y refina los agregados
calculados sin cambiar la precisión de búsqueda o de enfoque.

Cada entrada se puede buscar por nombre o por designación HYG, HIP, HD, HR, Gliese, Bayer y Flamsteed.

## El tiempo es una coordenada

El tiempo interno es un día juliano; `Date` solo existe en la frontera de la interfaz, y J2000
equivale a 2 451 545. Las posiciones del Sol, la Luna y los ocho planetas provienen de
[Astronomy Engine](https://github.com/cosinekitty/astronomy), ejecutado localmente: la biblioteca
valida sus modelos VSOP87 compactos y lunares contra NOVAS y JPL Horizons.

Los ejes de rotación y meridianos de origen siguen los
[elementos rotacionales IAU 2015](https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf),
dependientes de la fecha: Venus y Urano giran de forma retrógrada, y los anillos de Saturno heredan el
plano ecuatorial del planeta en lugar de una inclinación decorativa.

La línea temporal es editable en UTC con varias velocidades de simulación. La rotación terrestre
permanece astronómicamente exacta hasta un veinticuatroavo de día por segundo real, es decir una hora
simulada por segundo. Más allá, se limita a una vuelta cada 24 segundos reales para seguir siendo
legible, mientras las fechas y posiciones orbitales continúan a la velocidad solicitada.

## El motor de eclipses

El cálculo parte de la geometría física, antes de cualquier proyección sobre las esferas visualmente
adaptadas del mapa. El eje de sombra es la recta Sol-Luna; la Luna se proyecta sobre él para encontrar
el punto más cercano al eje, y la sombra se propaga en forma de cono.

Dos radios describen este cono a la distancia de la Tierra. El radio de sombra decrece a lo largo del
eje; si se vuelve negativo, el ápice del cono cae antes de la superficie, y el eclipse es anular en
lugar de total:

```typescript
function classifySolarEclipse(
  axisDistance: number,
  umbraRadius: number,
  penumbraRadius: number,
): SolarEclipsePhase {
  if (axisDistance >= EARTH_EQUATORIAL_RADIUS_AU + penumbraRadius) {
    return 'none';
  }
  if (axisDistance <= EARTH_EQUATORIAL_RADIUS_AU + Math.abs(umbraRadius)) {
    return umbraRadius >= 0 ? 'total' : 'annular'; // negative umbra apex → annular
  }
  return 'partial';
}
```

El eje se cruza luego con un elipsoide terrestre, no una esfera: radio ecuatorial y radio polar
distintos, en el sistema de referencia ecuatorial de la fecha. La raíz cercana de la ecuación de
segundo grado da el punto de contacto, convertido en latitud y longitud geográficas. Es ese punto el
que el mapa muestra como máximo. Cuando el discriminante es negativo, el eje falla la Tierra y solo se
conserva su dirección.

La línea de totalidad se muestrea en ±2,5 horas alrededor del máximo, 121 puntos por defecto, cada
punto llevado al instante mostrado para seguir la rotación terrestre.

Durante un eclipse solar, la sombra y la penumbra lunares se renderizan sobre la Tierra; durante un
eclipse lunar, la sombra terrestre se dibuja sobre la Luna. Las capas superpuestas (penumbra cian,
totalidad coral, anularidad oro) asumen un tamaño visual mínimo documentado: a la escala del globo, la
sombra física sería casi invisible.

Las vistas desde el suelo recalculan la relación aparente de los discos lunar y solar desde la
posición del observador, para que un eclipse anular nunca se renderice como total:

```typescript
function calculateSolarApparentDiscRatio(sunDistance: number, moonDistance: number): number {
  const sunAngularRadius = Math.asin(Math.min(1, SUN_RADIUS_AU / sunDistance));
  const moonAngularRadius = Math.asin(Math.min(1, MOON_RADIUS_AU / moonDistance));

  return sunAngularRadius === 0 ? 1 : moonAngularRadius / sunAngularRadius; // < 1 → annular
}
```

Un catálogo local calcula los próximos eclipses terrestres en el navegador. Para un eclipse solar, una
búsqueda por ubicación (`SearchLocalSolarEclipse`) distingue el máximo global del máximo observable en
diez ciudades francesas, con hora UTC, ocultación, altura del Sol y duración deducida de los instantes
de contacto.

## Contrastado con los valores publicados

Un renderizado de sombra puede ser plausible y falso. La validación pasa entonces por las referencias.

Las pruebas clasifican el 12 de agosto de 2026 como total y el 6 de febrero de 2027 como anular, y
recuperan las ocultaciones locales publicadas: 92,03 % en París (máximo a las 18:17 UTC, Sol a 7,72°
de altura), 99,41 % en Biarritz. También comparan el punto central del máximo con los
[elementos de Bessel del NASA GSFC](https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html):

```typescript
// greatest eclipse of 2026-08-12: central point vs published Besselian elements
expect(appearance.centralLatitude).toBeCloseTo(65.216, 3);
expect(appearance.centralLongitude).toBeCloseTo(-25.249, 3);
```

Las mismas suites clasifican los eclipses lunares contra sus máximos NASA y verifican los casos
degenerados: Sol y Luna coincidentes, alineación ausente, discos que tienden a cero.

El prototipo se sostiene con **1 225 pruebas** unitarias y de integración, más 64 pruebas de datos, de
documentación y de despliegue. La cobertura alcanza el **100 %** (instrucciones, ramas, funciones,
líneas) en el código de producción, con una puerta individual del 100 % por módulo científico
declarado, complementada por recorridos Chromium de escritorio y móvil. La cobertura previene las
regresiones; la validez científica se verifica por separado, contra valores de referencia, invariantes
y casos degenerados.

## Decir qué se mide y qué se dibuja

Cada objeto declara un nivel de confianza entre seis: `observed`, `calculated`, `extrapolated`,
`simulated`, `procedural`, `illustrative`. Las adaptaciones necesarias para la legibilidad (radios
exagerados, distancia Tierra-Luna amplificada, Vía Láctea procedural, continuidad de la red cósmica
marcada `simulated`) se identifican en la interfaz en lugar de silenciarse.

Las posiciones del Grupo Local provienen del catálogo de
[McConnachie 2012](https://www.astro.uvic.ca/~alan/Nearby_Dwarf_Database_files/mcconnachie2012.pdf),
la textura terrestre del
[Blue Marble](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/)
de la NASA, y la escala exterior de los 37 730 grupos de galaxias de
[Cosmicflows-4](https://doi.org/10.3847/1538-4357/ac94d8) cubre de 11,1 a 772,7 Mpc. El modelo de
efemérides se presenta por lo que es: visualización pedagógica, no navegación espacial.

Universe Map está en v0.1.0, un prototipo funcional desplegado en Azure Static Web App en
[super-universe.app](https://super-universe.app), código de aplicación bajo licencia MIT. La
continuación está encuadrada: trasladar la decodificación de catálogos y la preparación del octree a
Web Workers, e implementar la vista «Observable» que aplicará el retardo físico de la luz.

> Una visualización científica vale lo que valen sus puntos de control. Aquí, el mismo cálculo
> alimenta la sombra renderizada sobre el globo y el catálogo de eclipses, y recupera con tres
> decimales de precisión el punto central publicado para el 12 de agosto de 2026. El resto del mapa
> anuncia su nivel de confianza en lugar de dejarlo a la adivinación.
