The solar eclipse of August 12, 2026 will be total over Iceland then Spain; in France, the
occultation will exceed 92% in Paris and 99% in Biarritz.

Universe Map, an **Angular 21** + **Three.js r185** prototype, recomputes this event entirely in
the browser: umbra and penumbra projected on the globe, path of totality, ground-level views, a
local catalog of upcoming eclipses, and a central point verified against the Besselian elements
published by NASA.

Yet the eclipse is only one module. The project is a continuous 3D map of the Universe, in the
spirit of Google Maps: from a planet's surface to the Local Group, with no backend, no database,
and no network requests for the calculations.

## A continuous zoom across five orders of magnitude

Navigation isn't a collection of planetarium scenes. The scroll wheel unrolls a logarithmic path
across five scales (planetary, Solar System, stellar, galactic, Local Group), the camera keeps its
spatial anchor, and the path is reversible: zooming out from Earth to the Local Group and back
restores exactly the starting framing.

The Three.js engine lives in an `engine/` folder with no dependency on Angular components: the
application subscribes to a typed event facade, the render loop runs outside change detection, and
orbital calculations are capped at 12 Hz while rendering is not.

Beneath the map, hierarchical reference frames: each object is positioned relative to its parent
(the Moon under the Earth, the Earth under the Sun, the Sun within the Milky Way), scientific units
stay in the source data, and each scale applies its own distance compression to remain navigable.

That leaves the problem of large coordinates: a GPU computes in `float32`, and a few thousand
units from the origin, geometry starts to jitter. Hence a *floating origin* that recenters the
world on the camera target before precision degrades:

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

## 10,000 stars, a single draw call

The star field comes from the [HYG Database v4.1](https://github.com/astronexus/HYG-Database)
(CC BY-SA 4.0): the **10,000** brightest valid entries excluding the Sun, epoch J2000, converted
into a binary of about **782 KiB** where the coordinates remain in parsecs.

The parser validates signature, version, reference frame, and UTF-8 strings before exposing typed
arrays to the renderer, and the import can be replayed from the upstream CSV with a single command.

On the GPU side, the 10,000 stars share a single `THREE.Points` and a single `BufferGeometry`: one
draw call, at every scale and every quality level. Selecting a star doesn't create an object: a
single reusable level-of-detail group repositions itself onto it, moving from a point to an
on-screen halo and then to an emissive sphere on approach, while the other 9,999 remain in the
batch.

Every entry is searchable by name or by HYG, HIP, HD, HR, Gliese, Bayer, and Flamsteed designation.

## Time is a coordinate

Internal time is a Julian day; `Date` only exists at the interface boundary. The positions of the
Sun, the Moon, and the eight planets come from
[Astronomy Engine](https://github.com/cosinekitty/astronomy), run locally: its compact VSOP87 and
lunar models are validated upstream against NOVAS and JPL Horizons.

Rotation axes and prime meridians follow the
[IAU 2015 rotational elements](https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf),
date-dependent: Venus and Uranus rotate retrograde, and Saturn's rings inherit the planet's
equatorial plane rather than a decorative tilt.

The timeline is editable in UTC with eight simulation speeds; Earth's rotation stays
astronomically accurate up to one simulated hour per real second, then is capped at one turn per
24 real seconds to remain readable, while dates and orbital positions keep advancing at the
requested speed.

## The eclipse engine

Shadow calculations use physical radii and distances before any projection onto the map's
visually-adapted spheres, and the solar shadow axis is intersected with a flattened terrestrial
geoid in the equatorial frame of the date.

During a solar eclipse, the Moon's umbra and penumbra are rendered on Earth; during a lunar
eclipse, Earth's shadow is drawn on the Moon. The orbital overlays (cyan penumbra, coral totality,
gold annularity) assume a documented minimum visual size: at the scale of the globe, the physical
shadow would be nearly invisible.

Ground-level views recompute the apparent ratio of the lunar and solar discs from the observer's
position, so that an annular eclipse is never rendered as total:

```typescript
function calculateSolarApparentDiscRatio(sunDistance: number, moonDistance: number): number {
  const sunAngularRadius = Math.asin(Math.min(1, SUN_RADIUS_AU / sunDistance));
  const moonAngularRadius = Math.asin(Math.min(1, MOON_RADIUS_AU / moonDistance));

  return sunAngularRadius === 0 ? 1 : moonAngularRadius / sunAngularRadius; // < 1 → annular
}
```

A local catalog computes upcoming terrestrial eclipses in the browser and distinguishes the global
maximum from the maximum observable in ten French cities, with UTC time, local time, occultation,
and Sun altitude.

## Checked against published values

A shadow render can be plausible and wrong. Validation therefore goes through reference values.

The tests classify August 12, 2026 as total and February 6, 2027 as annular, and verify local
occultations (**92.03%** in Paris, **99.41%** in Biarritz) against published circumstances. They
also recover on the geoid the central point of the maximum, compared against the
[NASA GSFC Besselian elements](https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html):

```typescript
// greatest eclipse of 2026-08-12 — central point vs published Besselian elements
expect(appearance.centralLatitude).toBeCloseTo(65.216, 3);
expect(appearance.centralLongitude).toBeCloseTo(-25.249, 3);
```

The prototype holds up under **442** unit and integration tests, **100%** coverage (statements,
branches, functions, lines) on production code, an individual gate per scientific module, and
**25 Playwright** desktop and mobile journeys. Coverage guards against regressions; scientific
validity, in turn, is verified against reference values, invariants, and edge cases.

## Stating what is measured and what is drawn

Every object declares a confidence level among six: `observed`, `calculated`, `extrapolated`,
`simulated`, `procedural`, `illustrative`. The adaptations needed for readability (exaggerated
radii, amplified Earth-Moon distance, procedural Milky Way) are flagged in the interface rather
than passed over in silence.

Local Group positions come from the
[McConnachie 2012](https://www.astro.uvic.ca/~alan/Nearby_Dwarf_Database_files/mcconnachie2012.pdf)
catalog, the Earth texture from NASA's
[Blue Marble](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/),
and the ephemeris model presents itself for what it is: educational visualization, not spacecraft
navigation.

Universe Map is at v0.1.0, a functional prototype currently running locally; the code isn't
published yet. What's next is scoped: static star tiles loaded in workers, local circumstances for
an arbitrary location with contact times, and the "Observable" view (already in the interface,
still in simultaneous mode) which will apply the physical delay of light.

> A scientific visualization is only as good as its checkpoints. Here, the same calculation feeds
> both the shadow rendered on the globe and the eclipse catalog, and it recovers, to three decimal
> places, the published central point for August 12, 2026. The rest of the map states its
> confidence level instead of leaving it to guesswork.
