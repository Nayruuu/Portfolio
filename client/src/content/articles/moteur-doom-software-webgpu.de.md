Dieses Portfolio versteckt einen Ego-Shooter im DOOM-Stil, eine echte 3D-Engine im Browser,
**ohne Three.js und ohne WebGL**. Keine Grafikbibliothek: ein von Hand geschriebener *Software
Renderer*, der jeden Pixel in TypeScript berechnet, genau wie id Software es 1993 tat.

Der moderne Teil: derselbe Pixel kommt aus **drei austauschbaren Backends** (ein CPU-Single-Thread,
ein Worker-Pool, ein WebGPU-Compute-Shader), und ein Test beweist, dass sie alle **dasselbe Bild**
rendern.

## Das BSP-Rendering, im Stil von 1993

Die Karte wird zu einem **BSP**-Baum (Binary Space Partitioning) kompiliert: einer rekursiven
Aufteilung der Ebene, die für jede beliebige Kameraposition die exakte Reihenfolge der Wände vom
nächsten bis zum entferntesten liefert.

Das Rendering ist ein simpler *Front-to-Back*-Durchlauf: Man durchläuft den Baum, projiziert
jedes Wandsegment auf eine vertikale Spalte des Bildschirms, texturiert sie, und ein
**Z-Buffer** pro Spalte stoppt alles, was bereits verdeckt ist. Es gibt weder Overdraw noch
Objekt-Sortierung.

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

Die Projektion ist die von DOOM: eine feste Brennweite, eine Spaltenhöhe umgekehrt proportional
zur Tiefe, und ein vertikaler *Shear* für den Blick nach oben/unten. Böden und Decken werden in
horizontalen Streifen gefüllt, wobei jede Zeile ihren eigenen Welt-zu-Bildschirm-Maßstab trägt.

## Ein Backend reicht nicht

Dieses `renderFrame` ist **rein**: Eingabedaten, ein Pixelpuffer als Ausgabe, keine
Browser-API. Es ist die Referenz und zugleich der letzte Ausweg. Darüber liegen zwei
Beschleuniger.

Der erste teilt den Bildschirm in Zeilenbänder auf, verteilt auf einen **Worker-Pool**, alle
angeschlossen an **denselben** `SharedArrayBuffer`: Der Framebuffer wird ohne Kopie geteilt. Acht
Threads, ~4,5 ms pro Bild, konstante 120 fps. Der Preis dafür: Der geteilte Speicher erfordert
die **COOP/COEP**-Header auf *allen* Antworten, sonst ist `SharedArrayBuffer` nicht verfügbar und
der Worker rendert eine schwarze Canvas.

```typescript
// each worker renders its band [rowStart, rowEnd) into the shared framebuffer
renderFrame(map, camera, shared, zbuffer, band.rowStart, band.rowEnd);
```

Der zweite schiebt alles auf die **GPU im Compute-Modus**. Die CPU rasterisiert dort nicht mehr:
Sie *zeichnet* den BSP-Durchlauf als Befehlspuffer pro Spalte auf (Wandsegmente, Glasschichten,
Sprites), und ein **WGSL**-Shader führt sie parallel aus, bevor das Ergebnis zurück in den
Framebuffer gelesen wird. Keine Swap-Chain, keine WebGL-Canvas: reine Berechnung, und ein Bild
als Ergebnis.

## Derselbe Pixel, bewiesen

Drei Rendering-Pfade bedeuten auch drei Implementierungen, die auseinanderlaufen können. Die
Garantie stützt sich auf einen Test: **dieselbe Szene** über den CPU-Renderer und das WebGPU-Backend
in zwei Puffer rendern und diese dann vergleichen.

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

Die GPU rechnet in `f32`, die CPU mischt Ganzzahlen und Fließkommazahlen: Die Übereinstimmung
gilt *bis auf eine Toleranz*, nicht bitgenau.

Ein Playwright-Test steuert diesen Diff in einem echten Browser und verlangt weniger als **2 %**
der Pixel außerhalb der Toleranz. Wo `navigator.gpu` nicht existiert (jeder *headless*-Browser in
der CI), wird er **übersprungen**, statt dumm die CPU mit sich selbst zu vergleichen. Die Parität
ist eine Assertion, die läuft.

## Degradieren, ohne je einen schwarzen Bildschirm

Der Stack ist eine Fallback-Kaskade. Ist WebGPU verfügbar, läuft das Rendering auf der GPU.
Andernfalls übernimmt der Worker-Pool. Und ohne COOP/COEP, also ohne `SharedArrayBuffer`, bleibt
das Single-Thread-`renderFrame` auf dem Hauptthread: langsamer, aber universell.

Jeder Browser bekommt ein Bild; der leistungsfähigste hält 120 fps. Der Software-Renderer trägt
zwei Rollen: das Fundament, das überall läuft, und die Referenz, der der Paritätstest die GPU
gegenüberstellt.

> Einen Rasterizer 2026 von Hand neu zu schreiben, dient einem präzisen Ziel: die drei Backends
> **pixelgenau vergleichbar** zu machen. Die CPU definiert die Wahrheit, die GPU beschleunigt sie,
> und ein Test weigert sich, sie auseinanderdriften zu lassen.
