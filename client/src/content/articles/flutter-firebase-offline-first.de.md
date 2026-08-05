Der Verbindungsabbruch eines Mobilfunknetzes kündigt sich nicht an, und eine App, die jede Unterbrechung als
Fehler behandelt, wird unbrauchbar, sobald man in eine Tiefgarage fährt. Der **offline-first**-Ansatz
kehrt die Ausgangsannahme um: Die UI liest und schreibt in einen lokalen Speicher, das Netzwerk dient
nur dazu, diese Änderungen zu propagieren, wenn es verfügbar ist. Firestore setzt dieses Modell nativ
um, wodurch der Großteil der Arbeit auf Flutter Mobile bereits erledigt ist. Der Rest besteht vor
allem darin, sie nicht wieder zunichtezumachen.

## Der lokale Cache als Source of Truth der UI

Das Firestore-SDK unterhält einen persistenten lokalen Cache, und jede Lesung geht zuerst durch ihn
hindurch. Ein `get()` oder ein `snapshots()` liefert die Daten sofort aus dem Cache zurück, und
danach folgt ein Update, falls der Server abweicht. Die UI wartet nie auf das Netzwerk, um etwas
anzuzeigen.

Auf Android und iOS ist diese Persistenz standardmäßig aktiviert. Im Web ist sie es nicht: Man
braucht das explizite Opt-in, und genau dort zählt die Konfiguration.

```dart
FirebaseFirestore.instance.settings = const Settings(
  // On mobile this is already on; the web needs the explicit opt-in.
  cache: PersistentCacheSettings(
    sizeBytes: Settings.CACHE_SIZE_UNLIMITED,
  ),
);
```

`PersistentCacheSettings` ersetzt die alten Felder `persistenceEnabled` und `cacheSizeBytes`, die
weiterhin akzeptiert, aber als veraltet markiert sind. Der Cache hat standardmäßig eine begrenzte
Größe: Firestore verdrängt die am längsten nicht genutzten Dokumente, sobald das Limit erreicht ist,
und `CACHE_SIZE_UNLIMITED` hebt diese Grenze auf. Eine einzelne Lesung kann ihre Herkunft auch mit
`GetOptions(source: Source.cache)` oder `Source.server` erzwingen, wobei der Standardwert
`serverAndCache` auf den Cache zurückfällt, falls der Server nicht antwortet.

## Schreibvorgänge landen in einer Warteschlange

Ein Schreibvorgang offline schlägt nicht fehl und blockiert nicht. `set`, `update`, `delete` und
`WriteBatch` reihen sich in eine lokale Warteschlange ein, werden sofort auf den Cache angewendet und
bei Rückkehr des Netzwerks zum Server nachgespielt. Die am Dokument angehefteten Listener lösen sofort
mit dem neuen Wert aus: Genau das liefert eine optimistische UI, ohne dass Rollback-Code geschrieben
werden muss.

Die Warteschlange überlebt einen Neustart: Ein Schreibvorgang, der offline gemacht wurde, während die
App gleich danach beendet wurde, wird trotzdem beim nächsten verbundenen Start synchronisiert.
`waitForPendingWrites()` liefert ein `Future`, das abgeschlossen wird, sobald die Warteschlange geleert
ist — praktisch für einen „alles synchronisiert"-Indikator oder um einen Test zu sequenzieren.

Dieser Vorsprung hat einen Preis: Der Schreibvorgang wird auf dem Cache angewendet, bevor irgendeine
Server-Validierung stattfindet. Falls die Sicherheitsregeln ihn bei der Synchronisation ablehnen,
entfernt Firestore ihn aus dem Cache, und die Listener fallen auf den alten Wert zurück. Die
optimistische UI muss also im Rendering reversibel bleiben, ohne endgültigen Seiteneffekt, der allein
auf Basis des lokalen Schreibvorgangs ausgelöst wird.

## Die Snapshot-Metadaten lesen

Jeder Snapshot trägt ein `SnapshotMetadata` mit zwei Flags. `isFromCache` zeigt an, dass die Daten aus
dem lokalen Cache stammen und nicht aus einer Server-Antwort. `hasPendingWrites` zeigt an, dass ein
lokaler Schreibvorgang noch auf seine Bestätigung wartet. Zusammen beschreiben sie den exakten
Synchronisationsstatus eines Dokuments.

```dart
docRef
    .snapshots(includeMetadataChanges: true)
    .listen((snap) {
  final meta = snap.metadata;
  if (meta.hasPendingWrites) {
    // Local write not yet acknowledged by the server: show a "syncing" state.
  } else if (meta.isFromCache) {
    // Served from cache: offline, or before the first server round-trip.
  }
});
```

In diesem Code lauert eine Falle: Standardmäßig löst ein Stream nicht erneut aus, wenn sich nur die
Metadaten ändern. Ohne `includeMetadataChanges: true` löst der Übergang von `hasPendingWrites` zu
`false` (der Schreibvorgang wurde vom Server bestätigt) kein Ereignis aus, und das
„Synchronisierung läuft"-Badge verschwindet nie.

## Die Konnektivität informiert die Anzeige

Es ist verlockend, Firestore abzuschalten, sobald ein Netzwerkmonitor das Fehlen einer Verbindung
meldet. Das ist ein Fehler. Das [connectivity_plus-Paket](https://pub.dev/packages/connectivity_plus)
meldet den Status der Schnittstelle (WLAN, Mobilfunkdaten, keine), nicht die tatsächliche
Erreichbarkeit: Ein empfangenes WLAN ohne Internetzugang antwortet „verbunden". Firestore verwaltet
seine eigene Verbindung, seine Wiederverbindungen und seine Warteschlange; es machen zu lassen ist das
richtige Verhalten.

Die Konnektivität bleibt nützlich für die Anzeige: ein Offline-Banner, ein ausgegrauter Button, wenn
seine Aktion den Server benötigt. Sie informiert das Rendering, sie darf aber nicht die Firestore-
Aufrufe selbst bedingen.

## Konflikte: standardmäßig last-write-wins

Zwei Geräte ändern dasselbe Dokument offline und synchronisieren sich dann. Standardmäßig gewinnt der
zuletzt beim Server eingetroffene Schreibvorgang, Feld für Feld, und kann dabei einen zwischenzeitlich
gesetzten Wert überschreiben.

Bei einem Zähler umgeht `FieldValue.increment()` das Problem: Die Operation ist kommutativ, sodass
von mehreren Geräten nachgespielte Inkremente sich addieren, statt sich gegenseitig zu überschreiben.
Um konkurrierende Updates zu unterscheiden, liefert ein `updatedAt` mit `FieldValue.serverTimestamp()`
eine deterministische Ordnung, wobei der Zeitstempel vom Server zum Zeitpunkt der Synchronisation
gesetzt wird, nicht von der Uhr des Telefons.

```dart
// Commutative: replays from several devices add up instead of clobbering.
await ref.update({'views': FieldValue.increment(1)});

// Server-stamped at sync time, not from the device clock.
await ref.update({'updatedAt': FieldValue.serverTimestamp()});
```

Diese Sentinel-Werte haben eine Einschränkung auf der Cache-Seite: Solange der Server nicht bestätigt
hat, liest sich `serverTimestamp()` im lokalen Cache als `null` — das muss in der Anzeige behandelt
werden.

Wenn die Geschäftsregel vorschreibt, vor dem Schreiben zu lesen (ein Guthaben belasten, einen Bestand
reservieren), ist `runTransaction` das passende Werkzeug, funktioniert aber nicht offline: Eine
Transaktion erfordert einen Server-Roundtrip, wird nicht in die Warteschlange eingereiht und schlägt
fehl, wenn das Netzwerk fehlt. Das ist gewollt, da eine Transaktion ihre Invariante auf einem
möglicherweise veralteten Cache nicht garantieren kann. Die Logik, die kein last-write-wins verträgt,
lebt daher serverseitig, in der Transaktion oder einer Cloud Function, und wartet auf die Verbindung.

## Das Offline-Verhalten testen

Das Offline-Verhalten lässt sich überprüfen, ohne das WLAN von Hand abzuschalten. `disableNetwork()`
erzwingt den getrennten Modus, die Schreibvorgänge stapeln sich in der Warteschlange,
`enableNetwork()` spielt sie nach.

```dart
final db = FirebaseFirestore.instance;
await db.disableNetwork();

await docRef.update({'title': 'edited offline'}); // queued, not sent
// assert the local listener already reflects 'edited offline'

await db.enableNetwork();
await db.waitForPendingWrites(); // completes once the queue drains
```

Der [Offline-Guide von Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
beschreibt jede API im Detail: Cache, Lesequelle, Metadaten und Netzwerk-Umschaltung.

> Mit Firestore steht die Offline-Infrastruktur bereits: persistenter Cache, Schreib-Warteschlange,
> automatische Synchronisation bei Rückkehr des Netzwerks. Die Arbeit einer offline-first-App besteht
> vor allem darin, dem lokalen Cache sowohl beim Lesen als auch beim Schreiben zu vertrauen und das
> Netzwerk nicht reflexartig wieder in den Mittelpunkt zu stellen.
