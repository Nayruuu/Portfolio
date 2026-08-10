Ce portfolio embarque un FPS jouable dans un onglet caché. Derrière, un moteur 3D façon DOOM
écrit à la main, sans Three.js ni WebGL : un *software renderer* qui calcule chaque pixel en
TypeScript, exactement comme le faisait id Software en 1993. La résolution interne par défaut est
1280×720, le champ de vision 90°, et rien de tout ça ne passe par un pipeline graphique matériel
classique.

La contrainte que je me suis imposée est ailleurs. Le même moteur alimente un backend CPU réparti
sur plusieurs threads et un backend WebGPU en compute, et un test prouve que les deux rendent la
même image, à deux niveaux près par canal. Cette parité est la raison d'être de tout le reste :
c'est elle qui autorise à empiler des optimisations sans jamais perdre l'image de référence.

## Du raycaster à l'arbre BSP

La première version du jeu était un raycaster sur grille, à la Wolfenstein : des murs à angle
droit, une case ou du vide. Dès qu'il a fallu des salles à 45°, des sols et plafonds à hauteurs
variables, des fenêtres, le modèle grille est devenu un plafond. J'ai tout réécrit sur une
structure plus ancienne et plus capable : le **BSP** (Binary Space Partitioning), l'arbre que
DOOM compilait dans ses `.wad`.

Une carte est un jeu de segments de murs (`linedefs`) et de secteurs (des zones planes avec une
hauteur de sol et de plafond). Le compilateur découpe récursivement le plan : à chaque nœud il
choisit un segment comme partition, range les autres devant ou derrière, et coupe en deux ceux
qui traversent la ligne. Le choix du splitter minimise les découpes et équilibre l'arbre. Les
feuilles sont des cellules convexes, chacune appartenant à un seul secteur.

L'intérêt n'est pas le stockage, c'est l'ordre. Pour n'importe quelle position de caméra, un
parcours de l'arbre donne les murs triés du plus proche au plus lointain, sans trier quoi que ce
soit à l'exécution. Il suffit, à chaque nœud, de descendre d'abord du côté où se trouve la
caméra.

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

## La traversée front-to-back

Le rendu d'une image est une seule marche de cet arbre. Chaque segment visible se projette en une
tranche verticale de colonnes d'écran. La projection est celle de DOOM : une distance focale fixe
(`largeur / 2 / tan(fov / 2)`), une hauteur de mur inversement proportionnelle à la profondeur, et
le regard haut/bas obtenu par un décalage de l'horizon, pas par une vraie rotation de la caméra.

Deux mécanismes d'occlusion travaillent ensemble. Pour les murs, chaque colonne porte une fenêtre
d'ouverture (`topClip[x]`, `botClip[x]`) que la marche referme progressivement : dès qu'un mur
plein remplit la colonne, elle se ferme et les murs plus lointains n'y écrivent plus. C'est la
technique classique, sans over-draw. Pour tout ce qui se résout par la profondeur (sols,
plafonds, sprites, verre, volumes voxels), un **z-buffer par pixel** en `Float32` arbitre chaque
point : on n'écrit que si la nouvelle profondeur bat celle déjà là.

La coordonnée de texture horizontale d'un mur est la distance parcourue le long du `linedef`
d'origine, pas le long du segment. Comme le BSP découpe un mur en plusieurs morceaux, mesurer
depuis la ligne mère garde la texture continue à travers les coupes : aucune couture visible là
où le compilateur a tranché. L'interpolation de cette coordonnée se fait en `u/z`, corrigée par la
perspective, comme le reste de la projection.

Sols et plafonds ne se lancent pas par pixel. Chaque ligne d'écran porte une échelle
monde-vers-écran (`focal / (y − horizon)`) qui convertit d'un coup sa hauteur en profondeur, et
l'ombrage par distance devient un simple facteur par ligne au lieu d'une division par pixel.

## Une marche, deux sorties

Voilà l'articulation qui rend la double implémentation possible. La marche de l'arbre (l'ordre
BSP, le clipping, la projection) est écrite une seule fois. Ce qu'elle fait de chaque tranche
calculée passe par une interface, `WalkSink`. Un *sink* CPU peint la tranche tout de suite ; un
*sink* GPU l'enregistre dans un tampon de commandes, sans dessiner.

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

Le backend CPU branche un sink qui appelle directement les peintres logiciels. Le backend GPU
branche un sink qui sérialise chaque tranche dans des tableaux typés à plat : les spans groupés
par colonne dans leur ordre de peinture, les phases différées (verre, sprites) dans une liste
séparée. Ces tampons partent tels quels sur le GPU, et un shader **WGSL** de calcul, une
invocation par pixel, rejoue exactement la même séquence par colonne. Aucune rasterisation de
triangles nulle part : le GPU refait le travail de DOOM, pixel par pixel, en parallèle.

Ce découpage a un coût de discipline. Le shader WGSL doit reproduire les mêmes ancres de texture,
les mêmes troncatures, les mêmes constantes d'ombrage et de teinte que le code TypeScript. Une
poignée de constantes du renderer (l'ancre de tuilage, la teinte du verre, les facteurs d'ombrage
des faces de voxel) sont exportées précisément pour que le shader les transcrive à l'identique.

## Le même pixel, prouvé

Deux implémentations qui doivent produire la même image finissent toujours par diverger si rien ne
les surveille. La garantie tient à un test : rendre **une même scène** par le renderer CPU et par
le backend WebGPU, dans deux tampons séparés, puis les comparer canal par canal.

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

L'accord est à une tolérance près, pas au bit. Le GPU calcule en `f32`, le renderer CPU mêle
entiers et flottants double précision : une même géométrie retombe à un ou deux niveaux d'écart
par rounding. Un test Playwright pilote ce diff dans un vrai navigateur et exige moins de **2 %**
de pixels hors tolérance. Là où `navigator.gpu` n'existe pas, sur le Chromium *headless* d'une CI
par exemple, le test se déclare non exercé plutôt que de comparer le CPU à lui-même.

Le renderer software cumule ainsi deux rôles. Il est le socle universel qui tourne partout, et il
est la vérité que le test oppose au GPU. Toute optimisation du chemin WebGPU se mesure contre lui.

## Un octet par texel

Le moteur stocke ses textures comme DOOM : un **octet par texel**, un indice dans une palette de
256 couleurs (1024 octets de RGBA). L'invariant qui traverse tout le moteur est que l'indice 0 est
la seule entrée transparente. Chaque pixel source à alpha nul retombe sur 0, et le test `indice ≠
0` devient l'unique test de transparence sur tous les chemins d'échantillonnage, mur, sol, sprite,
verre, voxel.

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

Le gain mémoire est d'un facteur 3,6 sur la bibliothèque de textures. Les textures procédurales
n'y perdent rien : elles n'utilisent que quelques dizaines de couleurs, palettisées exactement (le
rendu reste bit-à-bit identique à l'époque RGBA). Les sources plus riches (du WebP compressé, de
l'occlusion ambiante cuite, quelques milliers à quelques dizaines de milliers de couleurs par
planche de 512²) passent par un *median cut* déterministe.

Ce median cut a un piège que j'ai failli laisser filer. Il ensemence une boîte par classe d'alpha,
de part et d'autre du seuil verre plein / verre clair (128), pour qu'aucune quantification ne
puisse moyenner une couleur d'un côté du seuil vers l'autre. Sans cette précaution, le premier
asset semi-transparent coloré aurait vu un texel opaque basculer en transparent en silence.

## Huit workers, un seul framebuffer

Le backend CPU ne rend pas sur un seul thread. Il découpe l'écran en bandes horizontales réparties
sur un pool de *workers*, jusqu'à huit selon la machine (`min(8, cœurs − 1)`, un cœur laissé au
thread principal). Chaque worker peint sa bande dans le **même** framebuffer et le même z-buffer,
un `SharedArrayBuffer` vu directement, sans copie. La géométrie est parcourue en entier par chacun,
mais les écritures sont bornées à sa bande.

Le prix d'entrée est connu : la mémoire partagée exige l'isolation cross-origin, donc les en-têtes
**COOP/COEP** sur *toutes* les réponses. Sans eux, `SharedArrayBuffer` est indisponible et il ne
reste que le rendu mono-thread.

Le partage vaut aussi pour les textures. Chaque worker recevait au départ sa copie de toute la
bibliothèque par *structured clone* : huit copies privées de chaque atlas et de chaque grille
voxel, environ 1,5 Go de pixels dupliqués une fois la doctrine voxel en place. La bibliothèque est
désormais empaquetée une fois dans un `SharedArrayBuffer`, et les workers en reçoivent des vues.
Le `postMessage` transfère la poignée sans cloner, et comme les pixels sont écrits une fois avant
l'envoi, aucun `Atomics` n'est nécessaire : les workers ne font que lire. La mesure, en Chromium
fenêtré sur le RSS de l'arbre de processus, est passée de 2707 Mo à 1197 Mo, soit −56 % de
l'empreinte du navigateur.

Un gouverneur surveille la contention entre workers. Son seul levier est le **nombre de workers
actifs**, jamais la résolution (qui achèterait du flou, pas de la cadence). Une réduction est un
essai mesuré : à la fin de sa fenêtre de refroidissement, il compare la latence de jointure à
l'ancre plein-régime, et il annule si c'est pire. Il ne descend jamais sous la moitié du pool.
Ainsi il ne peut pas être durablement moins bon que ne rien faire.

## Des sprites en volume

Les ennemis, le mobilier, les objets ramassables ne sont pas des images plates. Ce sont des
**volumes voxels**, ancrés dans le monde. Une grille de voxels ride une `Texture` ordinaire (des
tranches horizontales empilées, l'indice 0 pour une cellule vide), et le renderer la marche au
pixel avec un DDA 3D exact (l'algorithme d'Amanatides & Woo) : les distances de traversée de
cellule sont calculées, pas accumulées par échantillonnage, ce qui garde le rejeu `f32` du GPU
aligné sur la référence `f64`. Le premier voxel plein rencontré gagne, et il écrit sa profondeur
dans le z-buffer : le volume est de la vraie géométrie pour les sprites suivants.

Les grilles viennent de deux sources qui produisent le même encodage, à l'octet près. Certaines
sont sculptées à la main dans [MagicaVoxel](https://ephtracy.github.io/) et importées depuis leur
`.vox` ; d'autres sont taillées par intersection de silhouettes à partir d'une feuille de vues
directionnelles. Un `.vox` est déjà palettisé, donc son parsing garde les indices du fichier sans
expansion ×4 : une sculpture de 256 couleurs pèse 16,7 Mo au lieu de 67.

## Traverser les zones sans couture

Le bâtiment se parcourt sans chargement visible. Une ligne de type *portail de zone* est une vraie
fenêtre sur une autre carte. Pendant la marche principale, chaque colonne enregistre son ouverture
sur le portail ; ensuite, une passe voisine re-marche l'arbre de la zone d'en face avec la caméra
**translatée** dans ses coordonnées. La translation préserve les distances, donc les profondeurs
écrites restent cohérentes pour le z-buffer, les sprites et le verre. La récursion est bornée à un
saut : un portail vu à travers un portail peint sa texture pleine.

Côté workers, chaque zone déjà construite est gardée en cache par sa clé. Franchir une couture ne
recompile rien : un message `swap` promeut le voisin déjà tenu au rang de zone primaire, et seules
les zones jamais vues sont compilées. À la sortie d'une zone, un instantané gelé capture tout ce
que le joueur a pu changer (ennemis, barils, objets pris, portes) et le restaure à son retour,
pour que rien ne réapparaisse dans son dos.

Le tout s'empile en une cascade de repli. Si WebGPU est disponible, le rendu part sur le GPU. À la
moindre panne (un device perdu), le backend redescend définitivement sur le pool de workers. Et
sans COOP/COEP, donc sans framebuffer partagé, il reste le renderer mono-thread sur le thread
principal : plus lent, mais universel. Chaque navigateur obtient une image.

> Réécrire un rasteriseur logiciel en 2026 tenait à une raison : disposer d'une référence exacte du
> pixel. Le CPU fixe l'image, WebGPU l'accélère, un test les compare et refuse un écart de plus de
> deux niveaux par canal. Tout le reste (un octet par texel, un framebuffer partagé entre huit
> workers, des sprites en volume, des zones sans couture) s'appuie sur cette référence qui tient.
