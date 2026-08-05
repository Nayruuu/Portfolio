Este portfolio incluye un FPS jugable en una pestaña oculta. Detrás, un motor 3D al estilo DOOM
escrito a mano, sin Three.js ni WebGL: un *software renderer* que calcula cada píxel en
TypeScript, exactamente como lo hacía id Software en 1993. La resolución interna por defecto es
1280×720, el campo de visión 90°, y nada de esto pasa por un pipeline gráfico de hardware
clásico.

La restricción que me impuse está en otro lugar. El mismo motor alimenta un backend CPU repartido
en varios threads y un backend WebGPU en compute, y un test demuestra que ambos renderizan la
misma imagen, con dos niveles de margen por canal como máximo. Esta paridad es la razón de ser de todo lo demás:
es ella la que permite apilar optimizaciones sin perder nunca la imagen de referencia.

## Del raycaster al árbol BSP

La primera versión del juego era un raycaster sobre cuadrícula, a la Wolfenstein: muros en ángulo
recto, una celda o el vacío. En cuanto hicieron falta salas a 45°, suelos y techos con alturas
variables, ventanas, el modelo de cuadrícula se convirtió en un techo. Lo reescribí todo sobre una
estructura más antigua y más capaz: el **BSP** (Binary Space Partitioning), el árbol que
DOOM compilaba en sus `.wad`.

Un mapa es un conjunto de segmentos de muros (`linedefs`) y de sectores (zonas planas con una
altura de suelo y de techo). El compilador divide recursivamente el plano: en cada nodo
elige un segmento como partición, coloca los demás delante o detrás, y corta en dos los
que atraviesan la línea. La elección del splitter minimiza los cortes y equilibra el árbol. Las
hojas son celdas convexas, cada una perteneciente a un solo sector.

El interés no está en el almacenamiento, sino en el orden. Para cualquier posición de cámara, un
recorrido del árbol da los muros ordenados del más cercano al más lejano, sin ordenar nada en
tiempo de ejecución. Basta, en cada nodo, con descender primero por el lado en el que se encuentra
la cámara.

```typescript
// Walk the BSP: at each node the side the camera sits on is nearer, so recurse there first.
function eachSegFrontToBack(child: NodeChild, camera: Camera, visit: (seg: Seg) => void): void {
  if (child.kind === 'leaf') {
    for (const seg of child.subsector.segs) visit(seg);
    return;
  }
  const node = child.node;
  const cameraInFront = signedSide(node.partition, camera.x, camera.y) < 0;

  eachSegFrontToBack(cameraInFront ? node.front : node.back, camera, visit);
  eachSegFrontToBack(cameraInFront ? node.back : node.front, camera, visit);
}
```

## El recorrido front-to-back

Renderizar una imagen es una sola caminata de este árbol. Cada segmento visible se proyecta en una
franja vertical de columnas de pantalla. La proyección es la de DOOM: una distancia focal fija
(`largeur / 2 / tan(fov / 2)`), una altura de muro inversamente proporcional a la profundidad, y
la mirada arriba/abajo obtenida mediante un desplazamiento del horizonte, no por una rotación real
de la cámara.

Dos mecanismos de oclusión trabajan juntos. Para los muros, cada columna lleva una ventana
de apertura (`topClip[x]`, `botClip[x]`) que la caminata va cerrando progresivamente: en cuanto un muro
sólido llena la columna, esta se cierra y los muros más lejanos ya no escriben en ella. Es la
técnica clásica, sin over-draw. Para todo lo que se resuelve por profundidad (suelos,
techos, sprites, vidrio, volúmenes voxel), un **z-buffer por píxel** en `Float32` arbitra cada
punto: solo se escribe si la nueva profundidad supera a la que ya hay.

La coordenada de textura horizontal de un muro es la distancia recorrida a lo largo del `linedef`
de origen, no a lo largo del segmento. Como el BSP divide un muro en varios trozos, medir
desde la línea madre mantiene la textura continua a través de los cortes: ninguna costura visible donde
el compilador ha cortado. La interpolación de esta coordenada se hace en `u/z`, corregida por la
perspectiva, como el resto de la proyección.

Los suelos y techos no se lanzan por píxel. Cada línea de pantalla lleva una escala
mundo-a-pantalla (`focal / (y − horizon)`) que convierte de golpe su altura en profundidad, y
el sombreado por distancia se convierte en un simple factor por línea en lugar de una división por píxel.

## Una caminata, dos salidas

Aquí está la articulación que hace posible la doble implementación. La caminata del árbol (el orden
BSP, el clipping, la proyección) se escribe una sola vez. Lo que hace con cada franja
calculada pasa por una interfaz, `WalkSink`. Un *sink* CPU pinta la franja de inmediato; un
*sink* GPU la registra en un buffer de comandos, sin dibujar.

```typescript
// One walk of the BSP, two possible sinks. The CPU sink paints the span now;
// the GPU sink records it into a per-column command buffer for the WGSL shader.
export interface WalkSink {
  sky(x: number, y0: number, y1: number): void;
  flat(x: number, y0: number, y1: number, tex: Texture, name: string,
       planeZ: number, rayX: number, rayY: number, falloff: number, light: number): void;
  wall(x: number, y0: number, y1: number, tex: Texture, name: string,
       u: number, zPerRow: number, shade: number, forward: number): void;
}
```

El backend CPU conecta un sink que llama directamente a los pintores de software. El backend GPU
conecta un sink que serializa cada franja en arrays tipados planos: los spans agrupados
por columna en su orden de pintado, las fases diferidas (vidrio, sprites) en una lista
separada. Estos buffers salen tal cual hacia la GPU, y un shader **WGSL** de compute, una
invocación por píxel, reproduce exactamente la misma secuencia por columna. Ninguna rasterización de
triángulos en ningún sitio: la GPU rehace el trabajo de DOOM, píxel a píxel, en paralelo.

Esta división tiene un coste de disciplina. El shader WGSL debe reproducir los mismos anclajes de textura,
los mismos truncamientos, las mismas constantes de sombreado y de tinte que el código TypeScript. Un
puñado de constantes del renderer (el anclaje del mosaico, el tinte del vidrio, los factores de sombreado
de las caras del voxel) se exportan precisamente para que el shader las transcriba de forma idéntica.

## El mismo píxel, demostrado

Dos implementaciones que deben producir la misma imagen siempre acaban divergiendo si nada las
vigila. La garantía se sostiene en un test: renderizar **la misma escena** con el renderer CPU y con
el backend WebGPU, en dos buffers separados, y luego compararlos canal por canal.

```typescript
// The GPU walks the columns in f32; the CPU renderer mixes i32/f64. Identical geometry still lands
// a channel or two apart from rounding, so parity is "within tolerance", never bit-exact.
export const RENDER_PARITY_TOLERANCE = 2;

export function diffFrames(a: Uint8ClampedArray, b: Uint8ClampedArray, tolerance: number): FrameDiff {
  let maxChannelDiff = 0;
  let mismatchCount = 0;

  for (let i = 0; i < a.length; i += 4) {
    let exceeds = false;

    for (let c = 0; c < 3; c++) {           // RGB only: both backends write opaque frames
      const d = Math.abs(a[i + c] - b[i + c]);

      if (d > maxChannelDiff) maxChannelDiff = d;
      if (d > tolerance) exceeds = true;
    }
    if (exceeds) mismatchCount++;
  }

  return { pixelCount: a.length >> 2, maxChannelDiff, mismatchCount };
}
```

El acuerdo es con tolerancia, no bit a bit. La GPU calcula en `f32`, el renderer CPU mezcla
enteros y flotantes de doble precisión: una misma geometría acaba con uno o dos niveles de diferencia
por redondeo. Un test de Playwright ejecuta este diff en un navegador real y exige menos del **2 %**
de píxeles fuera de tolerancia. Donde `navigator.gpu` no existe, por ejemplo en el Chromium *headless* de una CI,
el test se declara no ejercido en lugar de comparar la CPU consigo misma.

El renderer de software acumula así dos roles. Es la base universal que funciona en todas partes, y es
la verdad con la que el test contrasta la GPU. Toda optimización de la ruta WebGPU se mide contra él.

## Un byte por texel

El motor almacena sus texturas como DOOM: un **byte por texel**, un índice en una paleta de
256 colores (1024 bytes de RGBA). El invariante que atraviesa todo el motor es que el índice 0 es
la única entrada transparente. Cada píxel de origen con alfa nulo cae en 0, y el test `índice ≠
0` se convierte en el único test de transparencia en todas las rutas de muestreo: muro, suelo, sprite,
vidrio, voxel.

```typescript
// A textured wall column: sample a 1-byte palette index, resolve it, shade, pack little-endian RGBA.
// Index 0 is the transparent slot, so `index !== 0` is the whole alpha test.
const pi = px[(vRaw & (th - 1)) * tw + texCol] << 2;

buf32[i] =
  0xff000000 |
  ((pal[pi + 2] * shade) << 16) |
  ((pal[pi + 1] * shade) << 8) |
  (pal[pi] * shade);
```

La ganancia de memoria es de un factor 3,6 en la biblioteca de texturas. Las texturas procedurales
no pierden nada con esto: usan solo unas pocas decenas de colores, paletizadas de forma exacta (el
render sigue siendo bit a bit idéntico a la época RGBA). Las fuentes más ricas (WebP comprimido, la
oclusión ambiental precocinada, unos pocos miles a decenas de miles de colores por
plancha de 512²) pasan por un *median cut* determinista.

Este median cut tiene una trampa que casi dejo pasar. Siembra una caja por clase de alfa,
a ambos lados del umbral vidrio pleno / vidrio claro (128), para que ninguna cuantización
pueda promediar un color de un lado del umbral hacia el otro. Sin esta precaución, el primer
asset semitransparente coloreado habría visto un texel opaco pasar a transparente en silencio.

## Ocho workers, un solo framebuffer

El backend CPU no renderiza en un solo hilo. Divide la pantalla en bandas horizontales repartidas
en un pool de *workers*, hasta ocho según la máquina (`min(8, núcleos − 1)`, un núcleo reservado al
hilo principal). Cada worker pinta su banda en el **mismo** framebuffer y el mismo z-buffer,
un `SharedArrayBuffer` visto directamente, sin copia. La geometría es recorrida por completo por cada uno,
pero las escrituras están limitadas a su banda.

El precio de entrada es conocido: la memoria compartida exige el aislamiento cross-origin, es decir, las cabeceras
**COOP/COEP** en *todas* las respuestas. Sin ellas, `SharedArrayBuffer` no está disponible y solo
queda el render monohilo.

El compartir también se aplica a las texturas. Al principio, cada worker recibía su propia copia de toda la
biblioteca mediante *structured clone*: ocho copias privadas de cada atlas y de cada cuadrícula
voxel, alrededor de 1,5 GB de píxeles duplicados una vez implantada la doctrina voxel. La biblioteca ahora
está empaquetada una sola vez en un `SharedArrayBuffer`, y los workers reciben vistas de ella.
El `postMessage` transfiere el handle sin clonar, y como los píxeles se escriben una vez antes
del envío, no se necesita ningún `Atomics`: los workers solo leen. La medición, en Chromium
con ventana sobre el RSS del árbol de procesos, pasó de 2707 MB a 1197 MB, es decir, −56 % de
la huella del navegador.

Un gobernador vigila la contención entre workers. Su única palanca es el **número de workers
activos**, nunca la resolución (que compraría desenfoque, no cadencia). Una reducción es un
ensayo medido: al final de su ventana de enfriamiento, compara la latencia de unión con
el ancla a pleno régimen, y la anula si es peor. Nunca baja de la mitad del pool.
Así, nunca puede ser de forma duradera peor que no hacer nada.

## Sprites en volumen

Los enemigos, el mobiliario, los objetos recolectables no son imágenes planas. Son
**volúmenes voxel**, anclados en el mundo. Una cuadrícula de voxels rellena una `Texture` ordinaria (rebanadas
horizontales apiladas, el índice 0 para una celda vacía), y el renderer la recorre al
píxel con un DDA 3D exacto (el algoritmo de Amanatides & Woo): las distancias de travesía de
celda se calculan, no se acumulan por muestreo, lo que mantiene la reproducción `f32` de la GPU
alineada con la referencia `f64`. El primer voxel sólido encontrado gana, y escribe su profundidad
en el z-buffer: el volumen es geometría real para los sprites siguientes.

Las cuadrículas provienen de dos fuentes que producen la misma codificación, byte a byte. Algunas
se esculpen a mano en [MagicaVoxel](https://ephtracy.github.io/) y se importan desde su
`.vox`; otras se tallan por intersección de siluetas a partir de una hoja de vistas
direccionales. Un `.vox` ya está paletizado, así que su parsing conserva los índices del archivo sin
expansión ×4: una escultura de 256 colores pesa 16,7 MB en lugar de 67.

## Atravesar las zonas sin costura

El edificio se recorre sin carga visible. Una línea de tipo *portal de zona* es una verdadera
ventana hacia otro mapa. Durante la caminata principal, cada columna registra su apertura
sobre el portal; después, un paso vecino vuelve a recorrer el árbol de la zona de enfrente con la cámara
**trasladada** a sus coordenadas. La traslación preserva las distancias, así que las profundidades
escritas siguen siendo coherentes para el z-buffer, los sprites y el vidrio. La recursión está limitada a un
salto: un portal visto a través de un portal pinta su textura completa.

Del lado de los workers, cada zona ya construida se guarda en caché por su clave. Cruzar una costura no
recompila nada: un mensaje `swap` promueve a la zona vecina ya cargada al rango de zona primaria, y solo
se compilan las zonas nunca vistas. Al salir de una zona, una instantánea congelada captura todo lo
que el jugador pudo cambiar (enemigos, barriles, objetos recogidos, puertas) y lo restaura a su vuelta,
para que nada reaparezca a sus espaldas.

Todo se apila en una cascada de repliegue. Si WebGPU está disponible, el render parte en la GPU. Ante la
menor avería (un device perdido), el backend baja definitivamente al pool de workers. Y
sin COOP/COEP, y por tanto sin framebuffer compartido, queda el renderer monohilo en el hilo
principal: más lento, pero universal. Cada navegador obtiene una imagen.

> Reescribir un rasterizador de software en 2026 se debía a una razón: disponer de una referencia exacta del
> píxel. La CPU fija la imagen, WebGPU la acelera, un test las compara y rechaza una diferencia de más de
> dos niveles por canal. Todo lo demás (un byte por texel, un framebuffer compartido entre ocho
> workers, sprites en volumen, zonas sin costura) se apoya en esta referencia que se sostiene.
