Ce portfolio cache un FPS façon DOOM — un vrai moteur 3D, dans le navigateur, **sans Three.js
ni WebGL**. Pas de bibliothèque graphique : un *software renderer* écrit à la main qui calcule
chaque pixel en TypeScript, exactement comme le faisait id Software en 1993. Le twist moderne :
le même pixel sort de **trois backends** interchangeables — un CPU mono-thread, un pool de
workers, et un shader de calcul WebGPU — et un test prouve qu'ils rendent tous **la même image**.

## Le rendu BSP, façon 1993

La carte est compilée en un arbre **BSP** (Binary Space Partitioning) : un découpage récursif du
plan qui donne, pour n'importe quelle position de caméra, l'ordre exact des murs du plus proche
au plus lointain. Le rendu est un simple parcours *front-to-back* : on traverse l'arbre, on
projette chaque segment de mur en une colonne verticale de l'écran, on la texture, et un
**z-buffer** par colonne arrête tout ce qui est déjà caché. Zéro over-draw, zéro tri d'objets.

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

La projection est celle de DOOM : une distance-focale fixe, une hauteur de colonne inversement
proportionnelle à la profondeur, et un *shear* vertical pour le regard haut/bas. Sols et plafonds
se remplissent par bandes horizontales, chaque ligne portant son échelle monde-vers-écran.

## Un backend ne suffit pas

Ce `renderFrame` est **pur** : des données en entrée, un tampon de pixels en sortie, aucune API
navigateur. C'est la référence — et le dernier recours. Au-dessus, deux accélérateurs.

Le premier découpe l'écran en bandes de lignes réparties sur un **pool de workers**, tous branchés
sur le **même** `SharedArrayBuffer` : le framebuffer est partagé sans copie. Huit threads, ~4,5 ms
par image, 120 fps tenus. Le prix d'entrée : la mémoire partagée exige les en-têtes **COOP/COEP**
sur *toutes* les réponses, sinon `SharedArrayBuffer` est indisponible et le worker rend un canvas noir.

```typescript
// each worker renders its band [rowStart, rowEnd) into the shared framebuffer
renderFrame(map, camera, shared, zbuffer, band.rowStart, band.rowEnd);
```

Le second pousse tout sur le **GPU en compute**. Le CPU n'y rasterise plus : il *enregistre* le
parcours BSP sous forme de tampons de commandes par colonne (spans de mur, couches de verre,
sprites), et un shader **WGSL** les exécute en parallèle avant de relire le résultat dans le
framebuffer. Pas de swap-chain, pas de canvas WebGL : du calcul pur, une image en retour.

## Le même pixel, prouvé

Trois chemins de rendu, c'est trois occasions de diverger. La garantie tient à un test : rendre
**une même scène** via le renderer CPU et le backend WebGPU, dans deux tampons, puis les comparer.

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

Le GPU calcule en `f32`, le CPU mêle entiers et flottants : l'accord est *à une tolérance près*,
pas au bit. Un test Playwright pilote ce diff sur un vrai navigateur et exige moins de **2 %** de
pixels hors tolérance. Là où `navigator.gpu` n'existe pas — tout navigateur *headless* de CI — il
se **saute** plutôt que de comparer bêtement le CPU à lui-même. La parité n'est pas un vœu ; c'est
une assertion qui tourne.

## Dégrader sans jamais d'écran noir

L'empilement est une cascade de repli. WebGPU disponible ? On rend sur le GPU. Sinon, le pool de
workers. Pas de COOP/COEP, donc pas de `SharedArrayBuffer` ? Le `renderFrame` mono-thread sur le
thread principal — plus lent, mais universel. Chaque navigateur obtient une image ; le plus
capable obtient 120 fps. Le renderer software n'est jamais un lot de consolation : c'est à la fois
le socle qui tourne partout **et** l'oracle qui garde le GPU honnête.

> Réécrire un rasteriseur à la main en 2026 n'a rien de nostalgique : c'est ce qui rend les trois
> backends **comparables au pixel**. Le CPU définit la vérité, le GPU l'accélère, et un test
> refuse de les laisser diverger.
