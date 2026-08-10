The August 12, 2026 solar eclipse will be total over Iceland and then northern Spain. In France,
the occultation will exceed 92% in Paris and 99% in Biarritz.

Universe Map, an **Angular 21** + **Three.js r185** prototype, recomputes this event entirely
in the browser: shadow and penumbra projected onto the globe, path of totality, ground-level views,
a local catalog of upcoming eclipses. The central point of the maximum is checked against the
Besselian elements published by NASA.

The eclipse is just one module. The project is a continuous 3D map of the Universe, from a planet's
surface to the cosmic web, with no backend, no database, and no network request for the computations.

## A continuous zoom across seven scales

Navigation isn't a collection of planetarium scenes. The scroll wheel unrolls a path
across seven scales, from the planetary view to the cosmic web of Cosmicflows-4, passing through the
Solar System, the stellar neighborhood, the Milky Way, the Local Group, and the nearby Universe.

The camera distances associated with these scales range from 4.8 to 420,000 scene units, close to
five orders of magnitude, and the interpolation between two anchors is logarithmic. The path is
reversible: zooming out from Earth to the cosmic web and then back returns the original
framing.

The Three.js engine lives in an `engine/` folder with no dependency on Angular components.
The application subscribes to a typed event facade, and the render loop runs outside of
change detection, with a delta capped at 100 ms to absorb a tab left in the background.

Rendering follows the display refresh rate, but heavy computation doesn't. The recalculation of
orbital positions and shadow is capped at one step every 1/24 of a second, i.e. at most 24 Hz, and
the `time-changed` event broadcast to the UI is throttled to about once every 120 ms.

Underneath the map, hierarchical reference frames: each object is positioned relative to its parent, the
Moon under Earth, Earth under the Sun, the Sun within the Milky Way. Scientific units
remain in the source data, and each scale applies its own distance compression to
stay navigable.

That leaves the problem of large coordinates. A GPU computes in `float32`, and within a few thousand
units of the origin the geometry starts to jitter. Hence a *floating origin* that recenters the world
onto the camera's target as soon as it moves 1,600 units away, before precision
degrades:

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

## 10,000 stars, a single draw call

The star field comes from the [HYG Database v4.1](https://github.com/astronexus/HYG-Database)
(CC BY-SA 4.0). The preprocessor retains the **10,000** brightest valid entries excluding the
Sun, down to apparent magnitude 13.45, at epoch J2000. The result is a **801,224-byte**
binary, about 782 KiB, where coordinates remain in parsecs.

The format is explicit: a 40-byte header, 36-byte records, a `UMSC` signature at version 2. The
parser validates the signature, the version, and the reference frame (equatorial cartesian),
then decodes each string with a `TextDecoder` in strict mode. It rejects a non-increasing sort
by magnitude, a duplicated HYG identifier, or a null position, and throws an error
rather than exposing questionable data to the renderer.

On the GPU side, the 10,000 stars share a single `THREE.Points` and a single `BufferGeometry`. One draw
call, at every scale and every quality level. Selecting a star doesn't create any
object: persistent overlays reposition themselves on top of it, from the point to the screen-space halo then to a
center-to-edge darkened sphere on approach, while the other 9,999 remain in the batch.

Beyond this compact set, a camera-driven loose octree streams only the visible regions
at 640 and 320 parsecs, drawn from 34 shared static chunks, and refines computed aggregates without
changing search or focus precision.

Each entry is searchable by name or by HYG, HIP, HD, HR, Gliese, Bayer, and Flamsteed designation.

## Time is a coordinate

Internal time is a Julian day; `Date` only exists at the UI boundary, and J2000
equals 2,451,545. The positions of the Sun, the Moon, and the eight planets come from
[Astronomy Engine](https://github.com/cosinekitty/astronomy), run locally: the library
validates its compact VSOP87 and lunar models against NOVAS and JPL Horizons.

Rotation axes and prime meridians follow the
[IAU 2015 rotational elements](https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf),
date-dependent: Venus and Uranus rotate retrograde, and Saturn's rings inherit the
planet's equatorial plane rather than a decorative tilt.

The timeline is editable in UTC with several simulation speeds. Earth's rotation remains
astronomically accurate up to one twenty-fourth of a day per real second, i.e. one simulated
hour per second. Beyond that, it's capped at one rotation per 24 real seconds to stay
readable, while dates and orbital positions keep advancing at the requested speed.

## The eclipse engine

The computation starts from the physical geometry, before any projection onto the map's visually
adapted spheres. The shadow axis is the Sun-Moon line; the Moon is projected onto it to find
the point closest to the axis, and the shadow propagates as a cone.

Two radii describe this cone at Earth's distance. The umbra radius decreases along the axis;
if it becomes negative, the cone's apex falls before the surface, and the eclipse is annular rather than
total:

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

The axis is then intersected with an Earth ellipsoid, not a sphere: distinct equatorial and
polar radii, in the equatorial frame of the date. The near root of the second-degree
equation gives the contact point, converted into geographic latitude and longitude. This is the point
the map displays as the maximum. When the discriminant is negative, the axis misses Earth and only
its direction is kept.

The path of totality is sampled over ±2.5 hours around the maximum, 121 points by default,
each point brought back to the displayed instant to follow Earth's rotation.

During a solar eclipse, the Moon's umbra and penumbra are rendered onto Earth; during a
lunar eclipse, Earth's shadow is drawn onto the Moon. The overlays (cyan penumbra, coral
totality, gold annularity) assume a documented minimum visual size: at the globe's scale,
the physical shadow would be nearly invisible.

The ground-level views recompute the apparent ratio of the lunar and solar disks from the
observer's position, so that an annular eclipse is never rendered as total:

```typescript
function calculateSolarApparentDiscRatio(sunDistance: number, moonDistance: number): number {
  const sunAngularRadius = Math.asin(Math.min(1, SUN_RADIUS_AU / sunDistance));
  const moonAngularRadius = Math.asin(Math.min(1, MOON_RADIUS_AU / moonDistance));

  return sunAngularRadius === 0 ? 1 : moonAngularRadius / sunAngularRadius; // < 1 → annular
}
```

A local catalog computes upcoming terrestrial eclipses in the browser. For a solar
eclipse, a location-based search (`SearchLocalSolarEclipse`) distinguishes the global maximum from the
maximum observable in ten French cities, with UTC time, occultation, Sun altitude, and duration
derived from the contact instants.

## Checked against published values

A shadow rendering can be plausible and wrong. Validation therefore goes through reference sources.

The tests classify August 12, 2026 as total and February 6, 2027 as annular, and recover the
published local occultations: 92.03% in Paris (maximum at 18:17 UTC, Sun at 7.72° altitude),
99.41% in Biarritz. They also compare the central point of the maximum against the
[NASA GSFC Besselian elements](https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html):

```typescript
// greatest eclipse of 2026-08-12: central point vs published Besselian elements
expect(appearance.centralLatitude).toBeCloseTo(65.216, 3);
expect(appearance.centralLongitude).toBeCloseTo(-25.249, 3);
```

The same test suites classify lunar eclipses against their NASA maxima and check degenerate
cases: coincident Sun and Moon, absent alignment, disks tending toward zero.

The prototype holds **1,225** unit and integration tests, plus 64 data, documentation, and
deployment tests. Coverage reaches **100%** (statements, branches, functions,
lines) on production code, with an individual 100% gate per declared scientific module,
complemented by desktop and mobile Chromium journeys. Coverage prevents regressions; scientific
validity is checked separately, against reference values, invariants, and
degenerate cases.

## Stating what is measured and what is drawn

Every object declares a confidence level among six: `observed`, `calculated`, `extrapolated`,
`simulated`, `procedural`, `illustrative`. The adaptations needed for readability
(exaggerated radii, amplified Earth-Moon distance, procedural Milky Way, cosmic-web continuity
marked `simulated`) are flagged in the UI rather than passed over in silence.

Local Group positions come from the
[McConnachie 2012](https://www.astro.uvic.ca/~alan/Nearby_Dwarf_Database_files/mcconnachie2012.pdf) catalog,
the Earth texture from NASA's
[Blue Marble](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/),
and the outer scale of the 37,730 galaxy groups from
[Cosmicflows-4](https://doi.org/10.3847/1538-4357/ac94d8) covers 11.1 to 772.7 Mpc. The
ephemeris model presents itself for what it is: educational visualization, not
spacecraft navigation.

Universe Map is at v0.1.0, a functional prototype deployed as an Azure Static Web App at
[super-universe.app](https://super-universe.app), application code under the MIT license. What's next is
scoped: move catalog decoding and octree preparation into Web Workers, and
implement the "Observable" view that will apply the physical delay of light.

> A scientific visualization is only as good as its checkpoints. Here, the same computation
> feeds both the shadow rendered on the globe and the eclipse catalog, and it recovers to three decimal
> places the published central point for August 12, 2026. The rest of the map states its
> confidence level instead of leaving it to guess.
