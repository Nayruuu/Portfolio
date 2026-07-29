Este portfolio esconde un FPS estilo DOOM — un verdadero motor 3D, en el navegador, **sin Three.js
ni WebGL**. Sin biblioteca gráfica: un *software renderer* escrito a mano que calcula
cada píxel en TypeScript, exactamente como lo hacía id Software en 1993. El giro moderno:
el mismo píxel sale de **tres backends** intercambiables — una CPU monohilo, un pool de
workers, y un shader de cómputo WebGPU — y una prueba demuestra que los tres renderizan **la misma imagen**.

## El renderizado BSP, a la manera de 1993

El mapa se compila en un árbol **BSP** (Binary Space Partitioning): una subdivisión recursiva del
plano que da, para cualquier posición de cámara, el orden exacto de los muros del más cercano
al más lejano. El renderizado es un simple recorrido *front-to-back*: se recorre el árbol, se
proyecta cada segmento de muro en una columna vertical de la pantalla, se texturiza, y un
**z-buffer** por columna detiene todo lo que ya está oculto. Cero over-draw, cero ordenamiento de objetos.

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
se rellenan por bandas horizontales, cada línea con su propia escala mundo-a-pantalla.

## Un backend no basta

Este `renderFrame` es **puro**: datos de entrada, un buffer de píxeles de salida, ninguna API
del navegador. Es la referencia — y el último recurso. Por encima, dos aceleradores.

El primero divide la pantalla en bandas de líneas repartidas entre un **pool de workers**, todos conectados
al **mismo** `SharedArrayBuffer`: el framebuffer se comparte sin copia. Ocho hilos, ~4,5 ms
por fotograma, 120 fps sostenidos. El precio de entrada: la memoria compartida exige las cabeceras **COOP/COEP**
en *todas* las respuestas, de lo contrario `SharedArrayBuffer` no está disponible y el worker renderiza un canvas negro.

```typescript
// each worker renders its band [rowStart, rowEnd) into the shared framebuffer
renderFrame(map, camera, shared, zbuffer, band.rowStart, band.rowEnd);
```

El segundo lo lleva todo a la **GPU en modo compute**. La CPU ya no rasteriza: *graba* el
recorrido BSP en forma de buffers de comandos por columna (spans de muro, capas de cristal,
sprites), y un shader **WGSL** los ejecuta en paralelo antes de releer el resultado en el
framebuffer. Sin swap-chain, sin canvas WebGL: cómputo puro, una imagen de vuelta.

## El mismo píxel, demostrado

Tres rutas de renderizado son tres ocasiones de divergir. La garantía descansa en una prueba: renderizar
**la misma escena** vía el renderer CPU y el backend WebGPU, en dos buffers, y luego compararlos.

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
no bit a bit. Una prueba Playwright ejecuta este diff en un navegador real y exige menos de **2 %** de
píxeles fuera de tolerancia. Donde `navigator.gpu` no existe — cualquier navegador *headless* de CI — la prueba
se **omite** en lugar de comparar tontamente la CPU consigo misma. La paridad no es un deseo; es
una aserción que se ejecuta.

## Degradar sin nunca una pantalla negra

El apilamiento es una cascada de repliegue. ¿WebGPU disponible? Se renderiza en la GPU. Si no, el pool de
workers. ¿Sin COOP/COEP, y por lo tanto sin `SharedArrayBuffer`? El `renderFrame` monohilo corre en el
hilo principal — más lento, pero universal. Cada navegador obtiene una imagen; el más
capaz obtiene 120 fps. El renderer software nunca es un premio de consolación: es a la vez
la base que funciona en todas partes **y** el oráculo que mantiene honesta a la GPU.

> Reescribir un rasterizador a mano en 2026 no tiene nada de nostálgico: es lo que hace que los tres
> backends sean **comparables píxel a píxel**. La CPU define la verdad, la GPU la acelera, y una prueba
> se niega a dejarlos divergir.
