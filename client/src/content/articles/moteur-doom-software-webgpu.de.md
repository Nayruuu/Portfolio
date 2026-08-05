Ein Portfolio mit einem spielbaren FPS in einem versteckten Tab. Dahinter steckt eine handgeschriebene 3D-Engine im DOOM-Stil, ganz ohne Three.js oder WebGL: ein *Software-Renderer*, der jeden Pixel in TypeScript berechnet, genau wie es id Software 1993 tat. Die interne Standardauflösung liegt bei 1280×720, das Sichtfeld bei 90°, und nichts davon läuft über eine klassische Hardware-Grafik-Pipeline.

Die Einschränkung, die ich mir selbst auferlegt habe, liegt woanders. Dieselbe Engine treibt sowohl ein CPU-Backend an, das über mehrere Threads verteilt ist, als auch ein WebGPU-Backend im Compute-Modus, und ein Test beweist, dass beide dasselbe Bild rendern, bis auf zwei Stufen pro Kanal. Diese Parität ist der eigentliche Daseinszweck von allem anderen: Sie erlaubt es, Optimierungen zu stapeln, ohne jemals das Referenzbild zu verlieren.

## Vom Raycaster zum BSP-Baum

Die erste Version des Spiels war ein Raycaster auf einem Gitter, à la Wolfenstein: Wände im rechten Winkel, ein Feld oder Leere. Sobald Räume mit 45°-Winkeln, Böden und Decken mit variabler Höhe sowie Fenster gebraucht wurden, stieß das Gittermodell an seine Grenzen. Ich habe alles auf eine ältere und leistungsfähigere Struktur umgeschrieben: den **BSP** (Binary Space Partitioning), den Baum, den DOOM in seinen `.wad`-Dateien kompilierte.

Eine Karte ist eine Menge von Wandsegmenten (`linedefs`) und Sektoren (planaren Zonen mit einer Boden- und Deckenhöhe). Der Compiler zerlegt die Ebene rekursiv: An jedem Knoten wählt er ein Segment als Trennlinie, ordnet die anderen davor oder dahinter ein und schneidet diejenigen, die die Linie kreuzen, in zwei Teile. Die Wahl des Splitters minimiert die Schnitte und hält den Baum ausgeglichen. Die Blätter sind konvexe Zellen, jede gehört zu genau einem Sektor.

Der eigentliche Nutzen liegt nicht in der Speicherung, sondern in der Reihenfolge. Für jede beliebige Kameraposition liefert ein Durchlauf des Baums die Wände sortiert vom nächsten zum entferntesten, ohne zur Laufzeit irgendetwas zu sortieren. Es genügt, an jedem Knoten zuerst auf der Seite abzusteigen, auf der sich die Kamera befindet.

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

## Der Front-to-Back-Durchlauf

Das Rendern eines Bildes ist ein einziger Gang durch diesen Baum. Jedes sichtbare Segment wird auf einen vertikalen Streifen von Bildschirmspalten projiziert. Die Projektion entspricht der von DOOM: eine feste Brennweite (`largeur / 2 / tan(fov / 2)`), eine Wandhöhe umgekehrt proportional zur Tiefe, und der Blick nach oben/unten wird durch eine Verschiebung des Horizonts erreicht, nicht durch eine echte Kamerarotation.

Zwei Verdeckungsmechanismen arbeiten zusammen. Für Wände trägt jede Spalte ein Öffnungsfenster (`topClip[x]`, `botClip[x]`), das der Durchlauf schrittweise schließt: Sobald eine volle Wand die Spalte ausfüllt, schließt sie sich, und weiter entfernte Wände schreiben dort nicht mehr hinein. Das ist die klassische Technik, ohne Over-Draw. Für alles, was per Tiefe aufgelöst wird (Böden, Decken, Sprites, Glas, Voxel-Volumen), entscheidet ein **Z-Buffer pro Pixel** in `Float32` an jedem Punkt: Es wird nur geschrieben, wenn die neue Tiefe die bereits vorhandene unterbietet.

Die horizontale Texturkoordinate einer Wand ist die zurückgelegte Distanz entlang des ursprünglichen `linedef`, nicht entlang des Segments. Da der BSP eine Wand in mehrere Stücke zerlegt, hält die Messung ab der Mutterlinie die Textur über die Schnitte hinweg durchgehend: keine sichtbare Naht dort, wo der Compiler geschnitten hat. Die Interpolation dieser Koordinate erfolgt in `u/z`, perspektivisch korrigiert, wie der Rest der Projektion.

Böden und Decken werden nicht pro Pixel gecastet. Jede Bildschirmzeile trägt einen Welt-zu-Bildschirm-Maßstab (`focal / (y − horizon)`), der ihre Höhe auf einen Schlag in Tiefe umrechnet, und die Schattierung nach Distanz wird zu einem einfachen Faktor pro Zeile statt einer Division pro Pixel.

## Ein Durchlauf, zwei Ausgänge

Hier liegt das Gelenk, das die doppelte Implementierung möglich macht. Der Durchlauf des Baums (die BSP-Reihenfolge, das Clipping, die Projektion) wird nur ein einziges Mal geschrieben. Was er mit jedem berechneten Streifen tut, läuft über ein Interface, `WalkSink`. Ein CPU-*Sink* malt den Streifen sofort; ein GPU-*Sink* zeichnet ihn in einen Befehlspuffer auf, ohne zu zeichnen.

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

Das CPU-Backend schaltet einen Sink dazwischen, der direkt die Software-Zeichner aufruft. Das GPU-Backend schaltet einen Sink dazwischen, der jeden Streifen in flache typisierte Arrays serialisiert: die Spans nach Spalte gruppiert in ihrer Zeichenreihenfolge, die verzögerten Phasen (Glas, Sprites) in einer separaten Liste. Diese Puffer wandern unverändert auf die GPU, und ein **WGSL**-Compute-Shader, ein Aufruf pro Pixel, spielt exakt dieselbe Sequenz pro Spalte nach. Nirgendwo findet eine Dreieck-Rasterisierung statt: Die GPU macht die Arbeit von DOOM nach, Pixel für Pixel, parallel.

Diese Aufteilung hat einen Preis an Disziplin. Der WGSL-Shader muss dieselben Textur-Ankerpunkte, dieselben Abschneidungen, dieselben Schattierungs- und Färbungskonstanten reproduzieren wie der TypeScript-Code. Eine Handvoll Renderer-Konstanten (der Tiling-Ankerpunkt, die Glasfärbung, die Schattierungsfaktoren der Voxel-Flächen) werden genau deshalb exportiert, damit der Shader sie identisch übernimmt.

## Derselbe Pixel, bewiesen

Zwei Implementierungen, die dasselbe Bild erzeugen müssen, driften immer irgendwann auseinander, wenn nichts sie überwacht. Die Garantie beruht auf einem Test: dieselbe Szene mit dem CPU-Renderer und mit dem WebGPU-Backend rendern, in zwei getrennte Puffer, und diese dann Kanal für Kanal vergleichen.

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

Die Übereinstimmung gilt bis auf eine Toleranz, nicht bitgenau. Die GPU rechnet in `f32`, der CPU-Renderer mischt Integer und Fließkommazahlen doppelter Genauigkeit: Dieselbe Geometrie landet durch Rundung ein bis zwei Stufen auseinander. Ein Playwright-Test steuert diesen Diff in einem echten Browser und verlangt weniger als **2 %** Pixel außerhalb der Toleranz. Wo `navigator.gpu` nicht existiert, etwa im *headless* Chromium einer CI, erklärt sich der Test als nicht ausgeführt, statt die CPU mit sich selbst zu vergleichen.

Der Software-Renderer vereint so zwei Rollen. Er ist das universelle Fundament, das überall läuft, und er ist die Wahrheit, gegen die der Test die GPU stellt. Jede Optimierung des WebGPU-Pfads wird an ihm gemessen.

## Ein Byte pro Texel

Die Engine speichert ihre Texturen wie DOOM: **ein Byte pro Texel**, ein Index in eine Palette von 256 Farben (1024 Byte RGBA). Die Invariante, die die gesamte Engine durchzieht, ist, dass der Index 0 der einzige transparente Eintrag ist. Jedes Quellpixel mit Alpha-Wert null fällt auf 0 zurück, und der Test `index ≠ 0` wird zum einzigen Transparenztest auf allen Sampling-Pfaden: Wand, Boden, Sprite, Glas, Voxel.

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

Der Speichergewinn beträgt Faktor 3,6 für die Texturbibliothek. Die prozeduralen Texturen verlieren dabei nichts: Sie nutzen nur ein paar Dutzend Farben, exakt palettiert (das Rendering bleibt bit-identisch zur RGBA-Ära). Die reichhaltigeren Quellen (komprimiertes WebP, gebackene Ambient Occlusion, einige Tausend bis Zehntausend Farben pro 512²-Tafel) laufen durch einen deterministischen *Median-Cut*.

Dieser Median-Cut hat eine Falle, die ich beinahe übersehen hätte. Er sät eine Box pro Alpha-Klasse aus, beiderseits der Schwelle Vollglas/Klarglas (128), damit keine Quantisierung eine Farbe von einer Seite der Schwelle auf die andere mitteln kann. Ohne diese Vorsichtsmaßnahme hätte das erste farbige, halbtransparente Asset ein opakes Texel stillschweigend in transparent umschlagen sehen.

## Acht Worker, ein einziger Framebuffer

Das CPU-Backend rendert nicht auf einem einzigen Thread. Es zerlegt den Bildschirm in horizontale Streifen, verteilt auf einen *Worker*-Pool, bis zu acht je nach Maschine (`min(8, Kerne − 1)`, ein Kern bleibt dem Haupt-Thread vorbehalten). Jeder Worker malt seinen Streifen in denselben Framebuffer und denselben Z-Buffer, ein `SharedArrayBuffer`, direkt eingesehen, ohne Kopie. Die Geometrie wird von jedem vollständig durchlaufen, aber die Schreibzugriffe sind auf seinen Streifen begrenzt.

Der Eintrittspreis ist bekannt: der geteilte Speicher erfordert die Cross-Origin-Isolation, also die **COOP/COEP**-Header auf *allen* Antworten. Ohne sie ist `SharedArrayBuffer` nicht verfügbar, und es bleibt nur das Single-Thread-Rendering.

Das Teilen gilt auch für die Texturen. Jeder Worker erhielt anfangs seine eigene Kopie der gesamten Bibliothek per *Structured Clone*: acht private Kopien jedes Atlas und jedes Voxel-Gitters, rund 1,5 GB duplizierter Pixel, sobald die Voxel-Doktrin galt. Die Bibliothek wird nun einmal in einen `SharedArrayBuffer` gepackt, und die Worker erhalten davon Views. Der `postMessage` überträgt den Handle ohne Klonen, und da die Pixel einmal geschrieben werden, bevor sie versandt werden, ist kein `Atomics` nötig: Die Worker lesen nur. Die Messung, im fenstergroßen Chromium anhand des RSS des Prozessbaums, sank von 2707 MB auf 1197 MB, also −56 % des Browser-Fußabdrucks.

Ein Gouverneur überwacht die Konkurrenz zwischen den Workern. Sein einziger Hebel ist die **Anzahl der aktiven Worker**, niemals die Auflösung (die Unschärfe kaufen würde, keine Framerate). Eine Reduzierung ist ein gemessener Versuch: Am Ende seines Abkühlfensters vergleicht er die Join-Latenz mit dem Vollbetrieb-Ankerwert und macht sie rückgängig, wenn es schlechter ist. Er geht nie unter die Hälfte des Pools. So kann er nie dauerhaft schlechter sein, als nichts zu tun.

## Sprites im Volumen

Die Gegner, das Mobiliar, die aufsammelbaren Objekte sind keine flachen Bilder. Es sind **Voxel-Volumen**, in der Welt verankert. Ein Voxel-Gitter füllt eine gewöhnliche `Texture` (horizontale Schichten übereinander gestapelt, Index 0 für eine leere Zelle), und der Renderer durchläuft es pixelgenau mit einem exakten 3D-DDA (dem Amanatides-&-Woo-Algorithmus): Die Durchquerungsdistanzen der Zellen werden berechnet, nicht durch Sampling akkumuliert, was das `f32`-Replay der GPU mit der `f64`-Referenz im Einklang hält. Das erste getroffene volle Voxel gewinnt, und es schreibt seine Tiefe in den Z-Buffer: Das Volumen ist echte Geometrie für die nachfolgenden Sprites.

Die Gitter stammen aus zwei Quellen, die dieselbe Kodierung erzeugen, byte-genau. Manche werden von Hand in [MagicaVoxel](https://ephtracy.github.io/) modelliert und aus ihrer `.vox`-Datei importiert; andere werden durch Silhouetten-Schnitt aus einem Blatt Richtungsansichten geschnitten. Eine `.vox`-Datei ist bereits palettiert, ihr Parsing behält also die Indizes der Datei ohne ×4-Expansion: Eine Skulptur mit 256 Farben wiegt 16,7 MB statt 67.

## Zonen nahtlos durchqueren

Das Gebäude lässt sich ohne sichtbares Laden durchqueren. Eine Linie vom Typ *Zonen-Portal* ist ein echtes Fenster auf eine andere Karte. Während des Haupt-Durchlaufs zeichnet jede Spalte ihre Öffnung auf das Portal auf; anschließend durchläuft ein benachbarter Pass den Baum der gegenüberliegenden Zone erneut, mit der Kamera in ihre Koordinaten **verschoben**. Die Verschiebung erhält die Distanzen, sodass die geschriebenen Tiefen für den Z-Buffer, die Sprites und das Glas konsistent bleiben. Die Rekursion ist auf einen Sprung begrenzt: Ein Portal, das durch ein Portal gesehen wird, malt seine volle Textur.

Auf der Worker-Seite wird jede bereits gebaute Zone unter ihrem Schlüssel im Cache gehalten. Eine Naht zu überqueren kompiliert nichts neu: Eine `swap`-Nachricht befördert die bereits gehaltene Nachbarzone zur primären Zone, und nur nie gesehene Zonen werden kompiliert. Beim Verlassen einer Zone erfasst ein eingefrorener Schnappschuss alles, was der Spieler verändert haben könnte (Gegner, Fässer, aufgenommene Objekte, Türen), und stellt es bei seiner Rückkehr wieder her, damit nichts hinter seinem Rücken neu erscheint.

Das Ganze stapelt sich zu einer Rückfall-Kaskade. Ist WebGPU verfügbar, läuft das Rendering auf der GPU los. Bei der geringsten Panne (ein verlorenes Device) fällt das Backend endgültig auf den Worker-Pool zurück. Und ohne COOP/COEP, also ohne geteilten Framebuffer, bleibt der Single-Thread-Renderer auf dem Haupt-Thread: langsamer, aber universell. Jeder Browser erhält ein Bild.

> Einen Software-Rasterizer 2026 neu zu schreiben, hatte einen Grund: über eine exakte Pixel-Referenz zu verfügen. Die CPU legt das Bild fest, WebGPU beschleunigt es, ein Test vergleicht beide und verweigert eine Abweichung von mehr als zwei Stufen pro Kanal. Alles andere (ein Byte pro Texel, ein geteilter Framebuffer über acht Worker, Sprites im Volumen, nahtlose Zonen) stützt sich auf diese Referenz, die hält.
