Übersetze ich den Artikel ins Deutsche unter Beibehaltung von Code, Links und technischen Begriffen.

Die Sonnenfinsternis vom 12. August 2026 wird über Island und Nordspanien total sein. In Frankreich
wird die Verdunkelung 92 % in Paris und 99 % in Biarritz überschreiten.

Universe Map, ein Prototyp aus **Angular 21** + **Three.js r185**, berechnet dieses Ereignis
vollständig im Browser neu: Kern- und Halbschatten, die auf den Globus projiziert werden, die
Totalitätslinie, Bodenansichten, ein lokaler Katalog kommender Finsternisse. Der zentrale Punkt des
Maximums wird gegen die von der NASA veröffentlichten Bessel-Elemente verifiziert.

Die Finsternis ist nur ein Modul. Das Projekt ist eine durchgehende 3D-Karte des Universums, vom
Boden eines Planeten bis zum kosmischen Netz, ohne Backend, ohne Datenbank und ohne Netzwerkanfrage
für die Berechnungen.

## Ein kontinuierlicher Zoom über sieben Skalen

Die Navigation ist keine Sammlung von Planetariumsszenen. Das Mausrad rollt eine Reise über sieben
Skalen ab, von der Planetenansicht bis zum kosmischen Netz von Cosmicflows-4, über das
Sonnensystem, die stellare Nachbarschaft, die Milchstraße, die Lokale Gruppe und das nahe Universum.

Die mit diesen Skalen verbundenen Kameraentfernungen reichen von 4,8 bis 420.000 Szeneneinheiten,
also fast fünf Größenordnungen, und die Interpolation zwischen zwei Ankerpunkten ist logarithmisch.
Die Reise ist reversibel: Von der Erde bis zum kosmischen Netz herauszuzoomen und dann
zurückzukehren stellt den Ausgangsrahmen wieder her.

Die Three.js-Engine lebt in einem `engine/`-Ordner ohne Abhängigkeit zu den Angular-Komponenten. Die
Anwendung abonniert eine Fassade aus typisierten Ereignissen, und die Render-Schleife läuft außerhalb
der Change Detection, mit einem auf 100 ms begrenzten Delta, um einen im Hintergrund gebliebenen Tab
abzufedern.

Das Rendering folgt der Bildwiederholrate, die aufwendigen Berechnungen jedoch nicht. Die Neuberechnung
der Orbitalpositionen und des Schattens ist auf einen Schritt alle 1/24 Sekunde begrenzt, also
höchstens 24 Hz, und das an die Benutzeroberfläche gesendete Ereignis `time-changed` ist auf etwa
eines alle 120 ms limitiert.

Unter der Karte liegen hierarchische Bezugspunkte: Jedes Objekt wird relativ zu seinem Elternobjekt
positioniert, der Mond unter der Erde, die Erde unter der Sonne, die Sonne in der Milchstraße. Die
wissenschaftlichen Einheiten bleiben in den Quelldaten erhalten, und jede Skala wendet ihre eigene
Distanzkompression an, um navigierbar zu bleiben.

Bleibt das Problem der großen Koordinaten. Eine GPU rechnet in `float32`, und schon einige Tausend
Einheiten von der Ursprung entfernt beginnt die Geometrie zu zittern. Daher ein *floating origin*, das
die Welt auf das Kameraziel rezentriert, sobald es sich um 1.600 Einheiten entfernt, bevor die
Präzision sich verschlechtert:

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

## 10.000 Sterne, ein einziger Draw Call

Das Sternenfeld stammt aus der [HYG Database v4.1](https://github.com/astronexus/HYG-Database)
(CC BY-SA 4.0). Der Präparator behält die **10.000** gültigen hellsten Einträge außer der Sonne, bis
zur scheinbaren Helligkeit 13,45, zur Epoche J2000. Das Ergebnis ist eine Binärdatei von
**801.224 Bytes**, etwa 782 KiB, wobei die Koordinaten in Parsec bleiben.

Das Format ist explizit: ein 40-Byte-Header, 36-Byte-Datensätze, eine `UMSC`-Signatur in Version 2.
Der Parser validiert die Signatur, die Version und das Referenzsystem (kartesisch äquatorial) und
dekodiert dann jede Zeichenkette mit einem `TextDecoder` im Strict-Modus. Er lehnt eine nicht
aufsteigende Sortierung nach Helligkeit, eine doppelte HYG-ID oder eine Nullposition ab und wirft
einen Fehler, anstatt zweifelhafte Daten dem Rendering auszusetzen.

Auf GPU-Seite teilen sich die 10.000 Sterne einen einzigen `THREE.Points` und eine einzige
`BufferGeometry`. Ein Draw Call, bei allen Skalen und allen Qualitätsstufen. Die Auswahl eines Sterns
erzeugt kein Objekt: persistente Overlays positionieren sich darauf, vom Punkt zum Bildschirm-Halo
bis hin zu einer Sphäre mit Mitte-Rand-Abdunkelung bei Annäherung, während die restlichen 9.999 im
Batch verbleiben.

Über dieses kompakte Set hinaus streamt ein von der Kamera gesteuerter loser Octree nur die
sichtbaren Regionen von 640 und 320 Parsec, entnommen aus 34 statischen gemeinsamen Paketen, und
verfeinert die berechneten Aggregate, ohne die Präzision der Suche oder des Fokus zu verändern.

Jeder Eintrag ist durchsuchbar nach Namen oder Bezeichnung HYG, HIP, HD, HR, Gliese, Bayer und
Flamsteed.

## Die Zeit ist eine Koordinate

Die interne Zeit ist ein julianisches Datum; `Date` existiert nur an der Schnittstelle zur
Benutzeroberfläche, und J2000 entspricht 2.451.545. Die Positionen der Sonne, des Mondes und der
acht Planeten stammen aus [Astronomy Engine](https://github.com/cosinekitty/astronomy), lokal
ausgeführt: Die Bibliothek validiert ihre kompakten VSOP87- und Mondmodelle gegen NOVAS und
JPL Horizons.

Die Rotationsachsen und Nullmeridiane folgen den
[IAU-2015-Rotationselementen](https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf),
die vom Datum abhängen: Venus und Uranus rotieren retrograd, und die Saturnringe übernehmen die
Äquatorebene des Planeten statt einer dekorativen Neigung.

Die Zeitleiste ist in UTC editierbar, mit mehreren Simulationsgeschwindigkeiten. Die Erdrotation
bleibt astronomisch exakt bis zu einem Vierundzwanzigstel Tag pro reale Sekunde, also einer
simulierten Stunde pro Sekunde. Darüber hinaus wird sie auf eine Umdrehung pro 24 reale Sekunden
begrenzt, um lesbar zu bleiben, während Daten und Orbitalpositionen mit der angeforderten
Geschwindigkeit weiterlaufen.

## Die Finsternis-Engine

Die Berechnung geht von der physikalischen Geometrie aus, vor jeder Projektion auf die visuell
angepassten Sphären der Karte. Die Schattenachse ist die Gerade Sonne-Mond; der Mond wird darauf
projiziert, um den der Achse nächsten Punkt zu finden, und der Schatten breitet sich kegelförmig aus.

Zwei Radien beschreiben diesen Kegel in Erdentfernung. Der Kernschattenradius nimmt entlang der
Achse ab; wird er negativ, fällt die Spitze des Kegels vor die Oberfläche, und die Finsternis ist
ringförmig statt total:

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

Die Achse wird anschließend mit einem Erdellipsoid geschnitten, keiner Kugel: unterschiedlicher
Äquator- und Polradius, im äquatorialen Bezugssystem des Datums. Die nahe Wurzel der
quadratischen Gleichung liefert den Kontaktpunkt, umgerechnet in geografische Breite und Länge.
Dieser Punkt ist es, den die Karte als Maximum anzeigt. Ist die Diskriminante negativ, verfehlt die
Achse die Erde, und nur ihre Richtung wird beibehalten.

Die Totalitätslinie wird über ±2,5 Stunden um das Maximum abgetastet, standardmäßig 121 Punkte,
wobei jeder Punkt auf den angezeigten Zeitpunkt zurückgeführt wird, um der Erdrotation zu folgen.

Während einer Sonnenfinsternis werden Kern- und Halbschatten des Mondes auf die Erde gerendert;
während einer Mondfinsternis zeichnet sich der Erdschatten auf den Mond. Die Overlays
(Halbschatten cyan, Totalität koralle, Ringförmigkeit gold) übernehmen eine dokumentierte
minimale visuelle Größe: Auf der Globus-Skala wäre der physikalische Schatten praktisch unsichtbar.

Die Bodenansichten berechnen das scheinbare Größenverhältnis der Mond- und Sonnenscheiben von der
Position des Beobachters aus neu, damit eine ringförmige Finsternis niemals als total dargestellt
wird:

```typescript
function calculateSolarApparentDiscRatio(sunDistance: number, moonDistance: number): number {
  const sunAngularRadius = Math.asin(Math.min(1, SUN_RADIUS_AU / sunDistance));
  const moonAngularRadius = Math.asin(Math.min(1, MOON_RADIUS_AU / moonDistance));

  return sunAngularRadius === 0 ? 1 : moonAngularRadius / sunAngularRadius; // < 1 → annular
}
```

Ein lokaler Katalog berechnet die nächsten Erdfinsternisse im Browser. Für eine Sonnenfinsternis
unterscheidet eine Suche nach Ort (`SearchLocalSolarEclipse`) das globale Maximum vom in zehn
französischen Städten beobachtbaren Maximum, mit UTC-Uhrzeit, Verdunkelung, Sonnenhöhe und aus den
Kontaktzeitpunkten abgeleiteter Dauer.

## Gegen veröffentlichte Werte kontrolliert

Ein Schattenrendering kann plausibel und trotzdem falsch sein. Die Validierung erfolgt daher gegen
Referenzen.

Die Tests klassifizieren den 12. August 2026 als total und den 6. Februar 2027 als ringförmig und
finden die veröffentlichten lokalen Verdunkelungen wieder: 92,03 % in Paris (Maximum um 18:17 UTC,
Sonnenhöhe bei 7,72°), 99,41 % in Biarritz. Sie vergleichen außerdem den zentralen Punkt des
Maximums mit den
[Bessel-Elementen des NASA GSFC](https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html):

```typescript
// greatest eclipse of 2026-08-12: central point vs published Besselian elements
expect(appearance.centralLatitude).toBeCloseTo(65.216, 3);
expect(appearance.centralLongitude).toBeCloseTo(-25.249, 3);
```

Dieselben Suiten klassifizieren Mondfinsternisse gegen ihre NASA-Maxima und prüfen Grenzfälle:
zusammenfallende Sonne und Mond, fehlende Ausrichtung, gegen null strebende Scheiben.

Der Prototyp umfasst **1.225** Unit- und Integrationstests, plus 64 Daten-, Dokumentations- und
Deployment-Tests. Die Abdeckung erreicht **100 %** (Anweisungen, Zweige, Funktionen, Zeilen) im
Produktionscode, mit einem individuellen 100-%-Gate pro deklariertem wissenschaftlichem Modul,
ergänzt durch Chromium-Desktop- und Mobile-Durchläufe. Die Abdeckung verhindert Regressionen; die
wissenschaftliche Validität wird separat geprüft, gegen Referenzwerte, Invarianten und Grenzfälle.

## Sagen, was gemessen und was gezeichnet ist

Jedes Objekt deklariert eines von sechs Vertrauensniveaus: `observed`, `calculated`,
`extrapolated`, `simulated`, `procedural`, `illustrative`. Die für die Lesbarkeit notwendigen
Anpassungen (übertriebene Radien, verstärkte Erde-Mond-Distanz, prozedurale Milchstraße, als
`simulated` markierte Kontinuität des kosmischen Netzes) werden in der Benutzeroberfläche
kenntlich gemacht, statt verschwiegen zu werden.

Die Positionen der Lokalen Gruppe stammen aus dem Katalog von
[McConnachie 2012](https://www.astro.uvic.ca/~alan/Nearby_Dwarf_Database_files/mcconnachie2012.pdf),
die Erdtextur aus dem
[Blue Marble](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/)
der NASA, und die äußere Skala der 37.730 Galaxienhaufen von
[Cosmicflows-4](https://doi.org/10.3847/1538-4357/ac94d8) deckt 11,1 bis 772,7 Mpc ab. Das
Ephemeridenmodell gibt sich als das aus, was es ist: pädagogische Visualisierung, keine
Raumfahrtnavigation.

Universe Map liegt in v0.1.0 vor, ein funktionsfähiger Prototyp, bereitgestellt als Azure Static
Web App auf [super-universe.app](https://super-universe.app), Anwendungscode unter MIT-Lizenz. Die
nächsten Schritte sind festgelegt: die Dekodierung der Kataloge und die Vorbereitung des Octrees in
Web Workers verlagern, sowie die „Beobachtbar"-Ansicht implementieren, die die physikalische
Lichtverzögerung anwenden wird.

> Eine wissenschaftliche Visualisierung ist so gut wie ihre Kontrollpunkte. Hier speist dieselbe
> Berechnung sowohl den auf dem Globus gerenderten Schatten als auch den Finsterniskatalog, und sie
> findet den für den 12. August 2026 veröffentlichten zentralen Punkt auf drei Nachkommastellen
> genau wieder. Der Rest der Karte gibt sein Vertrauensniveau an, statt es erraten zu lassen.
