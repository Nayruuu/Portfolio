L'éclipse solaire du 12 août 2026 sera totale en Islande puis en Espagne ; en France, l'occultation
dépassera 92 % à Paris et 99 % à Biarritz.

Universe Map, un prototype **Angular 21** + **Three.js r185**, recalcule cet événement entièrement
dans le navigateur : ombre et pénombre projetées sur le globe, trajectoire de la totalité, vues au
sol, catalogue local des prochaines éclipses, et un point central vérifié contre les éléments de
Bessel publiés par la NASA.

L'éclipse n'est pourtant qu'un module. Le projet est une carte 3D continue de l'Univers, dans
l'esprit de Google Maps : du sol d'une planète au Groupe local, sans backend ni base de données,
et sans requête réseau pour les calculs.

## Un zoom continu sur cinq ordres de grandeur

La navigation n'est pas une collection de scènes de planétarium. La molette déroule un trajet
logarithmique à travers cinq échelles (planétaire, Système solaire, stellaire, galactique, Groupe
local), la caméra conserve son ancre spatiale, et le trajet est réversible : dézoomer de la Terre
jusqu'au Groupe local puis revenir restitue exactement le cadrage de départ.

Le moteur Three.js vit dans un dossier `engine/` sans dépendance aux composants Angular :
l'application s'abonne à une façade d'événements typés, la boucle de rendu tourne hors de la
détection de changement, et les calculs orbitaux sont plafonnés à 12 Hz quand le rendu ne l'est
pas.

Sous la carte, des repères hiérarchiques : chaque objet est positionné relativement à son parent
(la Lune sous la Terre, la Terre sous le Soleil, le Soleil dans la Voie lactée), les unités
scientifiques restent dans les données sources, et chaque échelle applique sa propre compression
de distances pour rester navigable.

Reste le problème des grandes coordonnées : un GPU calcule en `float32`, et à quelques milliers
d'unités de l'origine la géométrie se met à trembler. D'où un *floating origin* qui recentre le
monde sur la cible de la caméra avant que la précision ne se dégrade :

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

## 10 000 étoiles, un seul draw call

Le champ stellaire vient de la [HYG Database v4.1](https://github.com/astronexus/HYG-Database)
(CC BY-SA 4.0) : les **10 000** entrées valides les plus brillantes hors Soleil, époque J2000,
converties en un binaire d'environ **782 Kio** où les coordonnées restent en parsecs.

Le parseur valide signature, version, repère et chaînes UTF-8 avant d'exposer des tableaux typés
au rendu, et l'import se rejoue depuis le CSV amont en une commande.

Côté GPU, les 10 000 étoiles partagent un seul `THREE.Points` et une seule `BufferGeometry` : un
draw call, à toutes les échelles et à tous les niveaux de qualité. Sélectionner une étoile ne crée
pas d'objet : un unique groupe de détail réutilisable se repositionne dessus, passe de point à
halo écran puis à une sphère émissive en approche, pendant que les 9 999 autres restent dans le
batch.

Chaque entrée est cherchable par nom ou par désignation HYG, HIP, HD, HR, Gliese, Bayer et
Flamsteed.

## Le temps est une coordonnée

Le temps interne est un jour julien ; `Date` n'existe qu'à la frontière de l'interface. Les
positions du Soleil, de la Lune et des huit planètes sortent
d'[Astronomy Engine](https://github.com/cosinekitty/astronomy), exécuté localement : ses modèles
VSOP87 compacts et lunaires sont validés en amont contre NOVAS et JPL Horizons.

Les axes de rotation et méridiens origines suivent les
[éléments rotationnels IAU 2015](https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf),
dépendants de la date : Vénus et Uranus tournent en rétrograde, et les anneaux de Saturne héritent
du plan équatorial de la planète plutôt que d'une inclinaison décorative.

La timeline est éditable en UTC avec huit vitesses de simulation ; la rotation terrestre reste
astronomiquement exacte jusqu'à une heure simulée par seconde réelle, puis est plafonnée à un tour
par 24 secondes réelles pour rester lisible, pendant que dates et positions orbitales continuent à
la vitesse demandée.

## Le moteur d'éclipses

Les calculs d'ombre utilisent les rayons et distances physiques avant toute projection sur les
sphères visuellement adaptées de la carte, et l'axe d'ombre solaire est intersecté avec un géoïde
terrestre aplati dans le repère équatorial de la date.

Pendant une éclipse solaire, ombre et pénombre lunaires sont rendues sur la Terre ; pendant une
éclipse lunaire, l'ombre terrestre se dessine sur la Lune. Les surcouches orbitales (pénombre
cyan, totalité corail, annularité or) assument une taille visuelle minimale documentée : à
l'échelle du globe, l'ombre physique serait quasi invisible.

Les vues au sol recalculent le rapport apparent des disques lunaire et solaire depuis la position
de l'observateur, pour qu'une éclipse annulaire ne soit jamais rendue comme totale :

```typescript
function calculateSolarApparentDiscRatio(sunDistance: number, moonDistance: number): number {
  const sunAngularRadius = Math.asin(Math.min(1, SUN_RADIUS_AU / sunDistance));
  const moonAngularRadius = Math.asin(Math.min(1, MOON_RADIUS_AU / moonDistance));

  return sunAngularRadius === 0 ? 1 : moonAngularRadius / sunAngularRadius; // < 1 → annular
}
```

Un catalogue local calcule les prochaines éclipses terrestres dans le navigateur et distingue le
maximum global du maximum observable dans dix villes françaises, avec heure UTC, heure locale,
occultation et hauteur du Soleil.

## Contrôlé contre les valeurs publiées

Un rendu d'ombre peut être plausible et faux. La validation passe donc par les références.

Les tests classent le 12 août 2026 en totale et le 6 février 2027 en annulaire, et vérifient les
occultations locales (**92,03 %** à Paris, **99,41 %** à Biarritz) contre les circonstances
publiées. Ils retrouvent aussi sur le géoïde le point central du maximum, comparé aux
[éléments de Bessel du NASA GSFC](https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html) :

```typescript
// greatest eclipse of 2026-08-12 — central point vs published Besselian elements
expect(appearance.centralLatitude).toBeCloseTo(65.216, 3);
expect(appearance.centralLongitude).toBeCloseTo(-25.249, 3);
```

Le prototype tient sous **442 tests** unitaires et d'intégration, une couverture à **100 %**
(instructions, branches, fonctions, lignes) sur le code de production, un gate individuel par
module scientifique et **25 parcours Playwright** desktop et mobile. La couverture empêche les
régressions ; la validité scientifique, elle, se vérifie contre des valeurs de référence, des
invariants et des cas dégénérés.

## Dire ce qui est mesuré et ce qui est dessiné

Chaque objet déclare un niveau de confiance parmi six : `observed`, `calculated`, `extrapolated`,
`simulated`, `procedural`, `illustrative`. Les adaptations nécessaires à la lisibilité (rayons
exagérés, distance Terre-Lune amplifiée, Voie lactée procédurale) sont identifiées dans
l'interface plutôt que passées sous silence.

Les positions du Groupe local viennent du catalogue de
[McConnachie 2012](https://www.astro.uvic.ca/~alan/Nearby_Dwarf_Database_files/mcconnachie2012.pdf),
la texture terrestre du
[Blue Marble](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/)
de la NASA, et le modèle d'éphémérides se présente pour ce qu'il est : de la visualisation
pédagogique, pas de la navigation spatiale.

Universe Map est en v0.1.0, un prototype fonctionnel qui tourne pour l'instant en local ; le code
n'est pas encore publié. La suite est cadrée : tuiles stellaires statiques chargées en workers,
circonstances locales pour un lieu arbitraire avec les heures de contact, et la vue « Observable »
(déjà dans l'interface, encore en mode simultané) qui appliquera le retard physique de la lumière.

> Une visualisation scientifique vaut ce que valent ses points de contrôle. Ici, le même calcul
> alimente l'ombre rendue sur le globe et le catalogue d'éclipses, et il retrouve à trois
> décimales près le point central publié pour le 12 août 2026. Le reste de la carte annonce son
> niveau de confiance au lieu de le laisser deviner.
