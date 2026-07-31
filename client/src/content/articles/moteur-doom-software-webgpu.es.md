Este portfolio esconde un FPS al estilo DOOM, un auténtico motor 3D en el navegador, **sin Three.js
ni WebGL**. Sin biblioteca gráfica: un *software renderer* escrito a mano que calcula
cada píxel en TypeScript, exactamente como lo hacía id Software en 1993.

La parte moderna: el mismo píxel sale de **tres backends** intercambiables (un CPU
mono-thread, un pool de workers, un shader de cómputo WebGPU), y un test demuestra que todos
renderizan **la misma imagen**.

## El renderizado BSP, a la manera de 1993

El mapa se compila en un árbol **BSP** (Binary Space Partitioning): una subdivisión recursiva del
plano que da, para cualquier posición de cámara, el orden exacto de los muros del más cercano
al más lejano.

El renderizado es un simple recorrido *front-to-back*: se recorre el árbol, se proyecta cada
segmento de muro en una columna vertical de la pantalla, se texturiza, y un **z-buffer** por
columna detiene todo lo que ya está oculto. No hay over-draw ni ordenación de objetos.

```typescript
// one wall wins per screen column x — the nearest unoccluded one
export function renderFrame(map: CompiledMap, cam: Camera, out: Uint8ClampedArray): void {
  walkBspFrontToBack(map.root, cam, (wall) => {
    const col = projectColumn(wall, cam); // screen height = focal / distance

    if (col.depth < zbuffer[col.x]) {
      drawTexturedColumn(out, col, map.textures);
      zbuffer[col.x] = col.depth; // this column is resolved for good
    }
  });
}
```

La proyección es la de DOOM: una distancia focal fija, una altura de columna inversamente
proporcional a la profundidad, y un *shear* vertical para la mirada arriba/abajo. Suelos y techos
se rellenan en bandas horizontales, y cada línea lleva su escala mundo-a-pantalla.

## Un backend no basta

Este `renderFrame` es **puro**: datos de entrada, un búfer de píxeles de salida, ninguna API
de navegador. Es la referencia, y también el último recurso. Por encima, dos aceleradores.

El primero divide la pantalla en bandas de líneas repartidas en un **pool de workers**, todos conectados
al **mismo** `SharedArrayBuffer`: el framebuffer se comparte sin copia. Ocho hilos, ~4,5 ms
por imagen, 120 fps sostenidos. El precio de entrada: la memoria compartida exige las cabeceras **COOP/COEP**
en *todas* las respuestas, de lo contrario `SharedArrayBuffer` no está disponible y el worker renderiza un canvas negro.

```typescript
// each worker renders its band [rowStart, rowEnd) into the shared framebuffer
renderFrame(map, camera, shared, zbuffer, band.rowStart, band.rowEnd);
```

El segundo lo empuja todo a la **GPU en modo cómputo**. La CPU ya no rasteriza allí: *registra* el
recorrido BSP en forma de búferes de comandos por columna (spans de muro, capas de cristal,
sprites), y un shader **WGSL** los ejecuta en paralelo antes de releer el resultado en el
framebuffer. Sin swap-chain ni canvas WebGL: cómputo puro, y una imagen de vuelta.

## El mismo píxel, demostrado

Tres caminos de renderizado son también tres implementaciones que pueden divergir. La garantía
descansa en un test: renderizar **una misma escena** vía el renderer de CPU y el backend WebGPU, en dos
búferes, y luego compararlos.

```typescript
export function diffFrames(a: Uint8ClampedArray, b: Uint8ClampedArray, tol: number): FrameDiff {
  let maxChannelDiff = 0;
  let mismatchCount = 0;

  for (let i = 0; i < a.length; i += 4) {
    // RGB only — alpha carries no visible signal
    for (let c = 0; c < 3; c++) {
      maxChannelDiff = Math.max(maxChannelDiff, Math.abs(a[i + c] - b[i + c]));
    }

    if (Math.abs(a[i] - b[i]) > tol) {
      mismatchCount++;
    }
  }

  return { pixelCount: a.length >> 2, maxChannelDiff, mismatchCount };
}
```

La GPU calcula en `f32`, la CPU mezcla enteros y flotantes: el acuerdo es *con cierta tolerancia*,
no bit a bit.

Un test de Playwright ejecuta este diff en un navegador real y exige menos del **2 %** de píxeles
fuera de tolerancia. Donde `navigator.gpu` no existe (cualquier navegador *headless* de CI), simplemente
se **omite** en lugar de comparar tontamente la CPU consigo misma. La paridad es una aserción que
se ejecuta.

## Degradar sin llegar nunca a una pantalla negra

El apilamiento es una cascada de repliegue. Si WebGPU está disponible, el renderizado arranca en la GPU.
Si no, el pool de workers toma el relevo. Y sin COOP/COEP, por lo tanto sin `SharedArrayBuffer`, queda
el `renderFrame` mono-thread en el hilo principal: más lento, pero universal.

Cada navegador obtiene una imagen; el más capaz sostiene 120 fps. El renderer software acumula
dos roles: la base que funciona en todas partes, y la referencia que el test de paridad opone a la GPU.

> Reescribir un rasterizador a mano en 2026 sirve a un objetivo preciso: hacer los tres backends
> **comparables al píxel**. La CPU define la verdad, la GPU la acelera, y un test se niega a
> dejarlos divergir.
