L'éclipse solaire du 12 août 2026 sera totale sur l'Islande puis le nord de l'Espagne. En France,
l'occultation dépassera 92 % à Paris et 99 % à Biarritz.

Universe Map, un prototype **Angular 21** + **Three.js r185**, recalcule cet événement entièrement
dans le navigateur : ombre et pénombre projetées sur le globe, ligne de totalité, vues au sol,
catalogue local des prochaines éclipses. Le point central du maximum est vérifié contre les éléments
de Bessel publiés par la NASA.

L'éclipse n'est qu'un module. Le projet est une carte 3D continue de l'Univers, du sol d'une planète
au réseau cosmique, sans backend, sans base de données, et sans requête réseau pour les calculs.

## Un zoom continu sur sept échelles

La navigation n'est pas une collection de scènes de planétarium. La molette déroule un trajet à
travers sept échelles, de la vue planétaire au réseau cosmique de Cosmicflows-4, en passant par le
Système solaire, le voisinage stellaire, la Voie lactée, le Groupe local et l'Univers proche.

Les distances de caméra associées à ces échelles vont de 4,8 à 420 000 unités de scène, soit près de
cinq ordres de grandeur, et l'interpolation entre deux ancres est logarithmique. Le trajet est
réversible : dézoomer de la Terre jusqu'au réseau cosmique puis revenir restitue le cadrage de
départ.

Le moteur Three.js vit dans un dossier `engine/` sans dépendance aux composants Angular.
L'application s'abonne à une façade d'événements typés, et la boucle de rendu tourne hors de la
détection de changement, avec un delta borné à 100 ms pour absorber un onglet resté en arrière-plan.

Le rendu suit la fréquence d'affichage, mais pas les calculs lourds. Le recalcul des positions
orbitales et de l'ombre est plafonné à un pas toutes les 1/24 de seconde, soit au plus 24 Hz, et
l'événement `time-changed` diffusé vers l'interface est limité à un toutes les 120 ms environ.

Sous la carte, des repères hiérarchiques : chaque objet est positionné relativement à son parent, la
Lune sous la Terre, la Terre sous le Soleil, le Soleil dans la Voie lactée. Les unités scientifiques
restent dans les données sources, et chaque échelle applique sa propre compression de distances pour
rester navigable.

Reste le problème des grandes coordonnées. Un GPU calcule en `float32`, et à quelques milliers
d'unités de l'origine la géométrie se met à trembler. D'où un *floating origin* qui recentre le monde
sur la cible de la caméra dès qu'elle s'éloigne de 1 600 unités, avant que la précision ne se
dégrade :

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

## 10 000 étoiles, un seul draw call

Le champ stellaire vient de la [HYG Database v4.1](https://github.com/astronexus/HYG-Database)
(CC BY-SA 4.0). Le préparateur retient les **10 000** entrées valides les plus brillantes hors
Soleil, jusqu'à la magnitude apparente 13,45, à l'époque J2000. Le résultat est un binaire de
**801 224 octets**, environ 782 Kio, où les coordonnées restent en parsecs.

Le format est explicite : un en-tête de 40 octets, des enregistrements de 36 octets, une signature
`UMSC` en version 2. Le parseur valide la signature, la version et le référentiel (cartésien
équatorial), puis décode chaque chaîne avec un `TextDecoder` en mode strict. Il refuse un tri par
magnitude non croissant, un identifiant HYG dupliqué ou une position nulle, et lève une erreur
plutôt que d'exposer des données douteuses au rendu.

Côté GPU, les 10 000 étoiles partagent un seul `THREE.Points` et une seule `BufferGeometry`. Un draw
call, à toutes les échelles et à tous les niveaux de qualité. Sélectionner une étoile ne crée pas
d'objet : des surcouches persistantes se repositionnent dessus, du point au halo écran puis à une
sphère à assombrissement centre-bord en approche, pendant que les 9 999 autres restent dans le batch.

Au-delà de ce lot compact, un octree lâche piloté par la caméra ne diffuse que les régions visibles
de 640 et 320 parsecs, tirées de 34 paquets statiques partagés, et affine les agrégats calculés sans
changer la précision de recherche ou de focus.

Chaque entrée est cherchable par nom ou par désignation HYG, HIP, HD, HR, Gliese, Bayer et Flamsteed.

## Le temps est une coordonnée

Le temps interne est un jour julien ; `Date` n'existe qu'à la frontière de l'interface, et J2000
vaut 2 451 545. Les positions du Soleil, de la Lune et des huit planètes sortent
d'[Astronomy Engine](https://github.com/cosinekitty/astronomy), exécuté localement : la bibliothèque
valide ses modèles VSOP87 compacts et lunaires contre NOVAS et JPL Horizons.

Les axes de rotation et méridiens origines suivent les
[éléments rotationnels IAU 2015](https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf),
dépendants de la date : Vénus et Uranus tournent en rétrograde, et les anneaux de Saturne héritent du
plan équatorial de la planète plutôt que d'une inclinaison décorative.

La timeline est éditable en UTC avec plusieurs vitesses de simulation. La rotation terrestre reste
astronomiquement exacte jusqu'à un vingt-quatrième de jour par seconde réelle, soit une heure
simulée par seconde. Au-delà, elle est plafonnée à un tour par 24 secondes réelles pour rester
lisible, pendant que dates et positions orbitales continuent à la vitesse demandée.

## Le moteur d'éclipses

Le calcul part de la géométrie physique, avant toute projection sur les sphères visuellement
adaptées de la carte. L'axe d'ombre est la droite Soleil-Lune ; la Lune y est projetée pour trouver
le point le plus proche de l'axe, et l'ombre se propage en cône.

Deux rayons décrivent ce cône à la distance de la Terre. Le rayon d'ombre décroît le long de l'axe ;
s'il devient négatif, l'apex du cône tombe avant la surface, et l'éclipse est annulaire plutôt que
totale :

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

L'axe est ensuite intersecté avec un ellipsoïde terrestre, pas une sphère : rayon équatorial et rayon
polaire distincts, dans le repère équatorial de la date. La racine proche de l'équation du second
degré donne le point de contact, converti en latitude et longitude géographiques. C'est ce point que
la carte affiche comme maximum. Quand le discriminant est négatif, l'axe manque la Terre et seule sa
direction est conservée.

La ligne de totalité est échantillonnée sur ±2,5 heures autour du maximum, 121 points par défaut,
chaque point ramené à l'instant affiché pour suivre la rotation terrestre.

Pendant une éclipse solaire, ombre et pénombre lunaires sont rendues sur la Terre ; pendant une
éclipse lunaire, l'ombre terrestre se dessine sur la Lune. Les surcouches (pénombre cyan, totalité
corail, annularité or) assument une taille visuelle minimale documentée : à l'échelle du globe,
l'ombre physique serait quasi invisible.

Les vues au sol recalculent le rapport apparent des disques lunaire et solaire depuis la position de
l'observateur, pour qu'une éclipse annulaire ne soit jamais rendue comme totale :

```typescript
function calculateSolarApparentDiscRatio(sunDistance: number, moonDistance: number): number {
  const sunAngularRadius = Math.asin(Math.min(1, SUN_RADIUS_AU / sunDistance));
  const moonAngularRadius = Math.asin(Math.min(1, MOON_RADIUS_AU / moonDistance));

  return sunAngularRadius === 0 ? 1 : moonAngularRadius / sunAngularRadius; // < 1 → annular
}
```

Un catalogue local calcule les prochaines éclipses terrestres dans le navigateur. Pour une éclipse
solaire, une recherche par lieu (`SearchLocalSolarEclipse`) distingue le maximum global du maximum
observable dans dix villes françaises, avec heure UTC, occultation, hauteur du Soleil et durée
déduite des instants de contact.

## Contrôlé contre les valeurs publiées

Un rendu d'ombre peut être plausible et faux. La validation passe donc par les références.

Les tests classent le 12 août 2026 en totale et le 6 février 2027 en annulaire, et retrouvent les
occultations locales publiées : 92,03 % à Paris (maximum à 18 h 17 UTC, Soleil à 7,72° de hauteur),
99,41 % à Biarritz. Ils comparent aussi le point central du maximum aux
[éléments de Bessel du NASA GSFC](https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html) :

```typescript
// greatest eclipse of 2026-08-12: central point vs published Besselian elements
expect(appearance.centralLatitude).toBeCloseTo(65.216, 3);
expect(appearance.centralLongitude).toBeCloseTo(-25.249, 3);
```

Les mêmes suites classent les éclipses lunaires contre leurs maxima NASA et vérifient les cas
dégénérés : Soleil et Lune confondus, alignement absent, disques tendant vers zéro.

Le prototype tient sous **1 225 tests** unitaires et d'intégration, plus 64 tests de données, de
documentation et de déploiement. La couverture atteint **100 %** (instructions, branches, fonctions,
lignes) sur le code de production, avec un gate individuel à 100 % par module scientifique déclaré,
complété par des parcours Chromium desktop et mobile. La couverture empêche les régressions ; la
validité scientifique se vérifie séparément, contre des valeurs de référence, des invariants et des
cas dégénérés.

## Dire ce qui est mesuré et ce qui est dessiné

Chaque objet déclare un niveau de confiance parmi six : `observed`, `calculated`, `extrapolated`,
`simulated`, `procedural`, `illustrative`. Les adaptations nécessaires à la lisibilité (rayons
exagérés, distance Terre-Lune amplifiée, Voie lactée procédurale, continuité du réseau cosmique
marquée `simulated`) sont identifiées dans l'interface plutôt que passées sous silence.

Les positions du Groupe local viennent du catalogue de
[McConnachie 2012](https://www.astro.uvic.ca/~alan/Nearby_Dwarf_Database_files/mcconnachie2012.pdf),
la texture terrestre du
[Blue Marble](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/)
de la NASA, et l'échelle extérieure des 37 730 groupes de galaxies de
[Cosmicflows-4](https://doi.org/10.3847/1538-4357/ac94d8) couvre 11,1 à 772,7 Mpc. Le modèle
d'éphémérides se présente pour ce qu'il est : de la visualisation pédagogique, pas de la navigation
spatiale.

Universe Map est en v0.1.0, un prototype fonctionnel déployé en Azure Static Web App sur
[super-universe.app](https://super-universe.app), code applicatif sous licence MIT. La suite est
cadrée : déplacer le décodage des catalogues et la préparation de l'octree dans des Web Workers, et
implémenter la vue « Observable » qui appliquera le retard physique de la lumière.

> Une visualisation scientifique vaut ce que valent ses points de contrôle. Ici, le même calcul
> alimente l'ombre rendue sur le globe et le catalogue d'éclipses, et il retrouve à trois décimales
> près le point central publié pour le 12 août 2026. Le reste de la carte annonce son niveau de
> confiance au lieu de le laisser deviner.
