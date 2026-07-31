Die Sonnenfinsternis vom 12. August 2026 wird in Island und dann in Spanien total sein; in
Frankreich wird die Verfinsterung in Paris 92 % und in Biarritz 99 % überschreiten.

Universe Map, ein Prototyp aus **Angular 21** + **Three.js r185**, berechnet dieses Ereignis
vollständig im Browser neu: Kern- und Halbschatten, die auf den Globus projiziert werden, die Bahn
der Totalität, Bodenansichten, ein lokaler Katalog der nächsten Finsternisse und ein Zentralpunkt,
der gegen die von der NASA veröffentlichten Bessel-Elemente verifiziert wird.

Die Finsternis ist jedoch nur ein Modul. Das Projekt ist eine durchgängige 3D-Karte des
Universums, im Geiste von Google Maps: vom Boden eines Planeten bis zur Lokalen Gruppe, ohne
Backend oder Datenbank und ohne Netzwerkanfrage für die Berechnungen.

## Ein durchgängiger Zoom über fünf Größenordnungen

Die Navigation ist keine Sammlung von Planetariumsszenen. Das Mausrad durchläuft eine
logarithmische Strecke über fünf Skalen (planetar, Sonnensystem, stellar, galaktisch, Lokale
Gruppe), die Kamera behält ihren räumlichen Anker, und die Strecke ist umkehrbar: Herauszoomen von
der Erde bis zur Lokalen Gruppe und wieder zurück stellt genau den Ausgangsbildausschnitt wieder
her.

Die Three.js-Engine lebt in einem `engine/`-Ordner ohne Abhängigkeit von den Angular-Komponenten:
Die Anwendung abonniert eine Fassade aus typisierten Ereignissen, die Render-Schleife läuft
außerhalb der Change Detection, und die Orbitalberechnungen sind auf 12 Hz begrenzt, während das
Rendering es nicht ist.

Unter der Karte liegen hierarchische Bezugssysteme: Jedes Objekt wird relativ zu seinem
übergeordneten Objekt positioniert (der Mond unter der Erde, die Erde unter der Sonne, die Sonne
in der Milchstraße), die wissenschaftlichen Einheiten bleiben in den Quelldaten erhalten, und jede
Skala wendet ihre eigene Distanzkompression an, um navigierbar zu bleiben.

Bleibt das Problem der großen Koordinaten: Eine GPU rechnet in `float32`, und schon einige tausend
Einheiten vom Ursprung entfernt beginnt die Geometrie zu zittern. Daher ein *Floating Origin*, der
die Welt auf das Kameraziel neu zentriert, bevor die Präzision sich verschlechtert:

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

## 10.000 Sterne, ein einziger Draw Call

Das Sternenfeld stammt aus der [HYG Database v4.1](https://github.com/astronexus/HYG-Database)
(CC BY-SA 4.0): die **10.000** hellsten gültigen Einträge ohne die Sonne, Epoche J2000,
konvertiert in eine Binärdatei von etwa **782 KiB**, in der die Koordinaten in Parsec bleiben.

Der Parser validiert Signatur, Version, Bezugssystem und UTF-8-Zeichenketten, bevor er typisierte
Arrays für das Rendering bereitstellt, und der Import lässt sich mit einem einzigen Befehl aus der
Quell-CSV neu ausführen.

Auf der GPU-Seite teilen sich die 10.000 Sterne ein einziges `THREE.Points` und eine einzige
`BufferGeometry`: ein Draw Call, auf allen Skalen und bei allen Qualitätsstufen. Die Auswahl eines
Sterns erzeugt kein neues Objekt: Eine einzige wiederverwendbare Detailgruppe wird darauf
repositioniert, wechselt von Punkt zu Bildschirm-Halo und dann bei Annäherung zu einer emissiven
Kugel, während die 9.999 anderen im Batch verbleiben.

Jeder Eintrag ist über Namen oder HYG-, HIP-, HD-, HR-, Gliese-, Bayer- und Flamsteed-Bezeichnung
durchsuchbar.

## Die Zeit ist eine Koordinate

Die interne Zeit ist ein Julianisches Datum; `Date` existiert nur an der Grenze zur
Benutzeroberfläche. Die Positionen von Sonne, Mond und den acht Planeten stammen aus der
[Astronomy Engine](https://github.com/cosinekitty/astronomy), die lokal ausgeführt wird: ihre
kompakten VSOP87- und Mondmodelle sind vorab gegen NOVAS und JPL Horizons validiert.

Die Rotationsachsen und Null-Meridiane folgen den
[IAU-2015-Rotationselementen](https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf),
die vom Datum abhängen: Venus und Uranus rotieren retrograd, und die Ringe des Saturn übernehmen
die Äquatorialebene des Planeten statt einer dekorativen Neigung.

Die Zeitleiste ist in UTC editierbar, mit acht Simulationsgeschwindigkeiten; die Erdrotation
bleibt astronomisch exakt bis zu einer simulierten Stunde pro realer Sekunde, wird dann aber auf
eine Umdrehung pro 24 reale Sekunden begrenzt, um lesbar zu bleiben, während Daten und
Orbitalpositionen mit der geforderten Geschwindigkeit weiterlaufen.

## Die Finsternis-Engine

Die Schattenberechnungen verwenden die physikalischen Radien und Distanzen, bevor irgendeine
Projektion auf die visuell angepassten Kugeln der Karte erfolgt, und die solare Schattenachse wird
mit einem abgeplatteten Erdgeoid im Äquatorialsystem des Datums geschnitten.

Während einer Sonnenfinsternis werden Kern- und Halbschatten des Mondes auf die Erde gerendert;
während einer Mondfinsternis zeichnet sich der Erdschatten auf dem Mond ab. Die orbitalen Overlays
(cyanfarbener Halbschatten, korallenfarbene Totalität, goldene Ringförmigkeit) nehmen eine
dokumentierte visuelle Mindestgröße an: Auf der Skala des Globus wäre der physikalische Schatten
nahezu unsichtbar.

Die Bodenansichten berechnen das scheinbare Größenverhältnis von Mond- und Sonnenscheibe aus der
Position des Beobachters neu, damit eine ringförmige Finsternis niemals als total dargestellt
wird:

```typescript
function calculateSolarApparentDiscRatio(sunDistance: number, moonDistance: number): number {
  const sunAngularRadius = Math.asin(Math.min(1, SUN_RADIUS_AU / sunDistance));
  const moonAngularRadius = Math.asin(Math.min(1, MOON_RADIUS_AU / moonDistance));

  return sunAngularRadius === 0 ? 1 : moonAngularRadius / sunAngularRadius; // < 1 → annular
}
```

Ein lokaler Katalog berechnet die nächsten irdischen Finsternisse im Browser und unterscheidet das
globale Maximum vom in zehn französischen Städten beobachtbaren Maximum, mit UTC-Zeit, Ortszeit,
Verfinsterungsgrad und Sonnenhöhe.

## Gegen veröffentlichte Werte kontrolliert

Ein Schatten-Rendering kann plausibel und trotzdem falsch sein. Die Validierung erfolgt daher
gegen Referenzwerte.

Die Tests klassifizieren den 12. August 2026 als total und den 6. Februar 2027 als ringförmig und
überprüfen die lokalen Verfinsterungsgrade (**92,03 %** in Paris, **99,41 %** in Biarritz) gegen
die veröffentlichten Umstände. Sie finden auf dem Geoid auch den Zentralpunkt des Maximums wieder,
verglichen mit den
[Bessel-Elementen des NASA GSFC](https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html):

```typescript
// greatest eclipse of 2026-08-12 — central point vs published Besselian elements
expect(appearance.centralLatitude).toBeCloseTo(65.216, 3);
expect(appearance.centralLongitude).toBeCloseTo(-25.249, 3);
```

Der Prototyp umfasst **442** Unit- und Integrationstests, eine Abdeckung von **100 %**
(Anweisungen, Verzweigungen, Funktionen, Zeilen) im Produktionscode, ein individuelles Gate pro
wissenschaftlichem Modul und **25 Playwright-Durchläufe** für Desktop und Mobil. Die Abdeckung
verhindert Regressionen; die wissenschaftliche Gültigkeit hingegen wird gegen Referenzwerte,
Invarianten und Grenzfälle geprüft.

## Sagen, was gemessen und was gezeichnet ist

Jedes Objekt deklariert einen von sechs Vertrauensgraden: `observed`, `calculated`,
`extrapolated`, `simulated`, `procedural`, `illustrative`. Die für die Lesbarkeit notwendigen
Anpassungen (übertriebene Radien, verstärkte Erde-Mond-Distanz, prozedurale Milchstraße) werden in
der Benutzeroberfläche kenntlich gemacht, statt verschwiegen zu werden.

Die Positionen der Lokalen Gruppe stammen aus dem Katalog von
[McConnachie 2012](https://www.astro.uvic.ca/~alan/Nearby_Dwarf_Database_files/mcconnachie2012.pdf),
die Erdtextur aus dem
[Blue Marble](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/)
der NASA, und das Ephemeriden-Modell präsentiert sich als das, was es ist: pädagogische
Visualisierung, keine Raumfahrtnavigation.

Universe Map steht bei v0.1.0, ein funktionsfähiger Prototyp, der vorerst lokal läuft; der Code
ist noch nicht veröffentlicht. Die Fortsetzung ist umrissen: statische Stern-Kacheln, die in
Workern geladen werden, lokale Umstände für einen beliebigen Ort mit den Kontaktzeiten, und die
Ansicht „Observable“ (bereits in der Oberfläche vorhanden, noch im Simultanmodus), die die
physikalische Lichtverzögerung anwenden wird.

> Eine wissenschaftliche Visualisierung ist so viel wert wie ihre Kontrollpunkte. Hier speist
> dieselbe Berechnung sowohl den auf den Globus gerenderten Schatten als auch den
> Finsternis-Katalog, und sie findet den für den 12. August 2026 veröffentlichten Zentralpunkt auf
> drei Nachkommastellen genau wieder. Der Rest der Karte gibt seinen Vertrauensgrad an, statt ihn
> erraten zu lassen.
