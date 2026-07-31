Auf Mobilgeräten ist Konnektivität nie garantiert: U-Bahn, Aufzug, Flugzeug. Eine
**Offline-First**-App behandelt das Offline-Sein als Normalzustand, nicht als Fehler: Das Netzwerk
ist nur eine Optimierung. Mit Flutter und Firebase ist das fast geschenkt.

## Firestore ist standardmäßig offline-first

Das Firestore-SDK hält einen lokalen persistenten Cache und **bedient Lesevorgänge aus diesem Cache**,
wenn das Netzwerk fehlt. Auf Mobilgeräten ist das standardmäßig aktiviert; man kann es explizit konfigurieren:

```dart
FirebaseFirestore.instance.settings = const Settings(
  persistenceEnabled: true,
  cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
);
```

### Schreibvorgänge werden in eine Warteschlange gestellt

Ein Schreibvorgang im Offline-Modus schlägt nicht fehl: Er reiht sich in eine lokale **Warteschlange**
ein, die bei Rückkehr des Netzwerks erneut abgespielt wird. Die UI kann die Daten sofort anzeigen (optimistisches Lesen) dank
des Flags `hasPendingWrites`, das in den Metadaten des Snapshots verfügbar ist:

```dart
stream.listen((snapshot) {
  final source = snapshot.metadata.hasPendingWrites ? 'local' : 'server';
  // show a "syncing" badge while source == 'local'
});
```

## Konflikte auflösen

Zwei Geräte können dasselbe Dokument offline ändern. Standardmäßig gilt **last-write-wins**,
was Daten überschreiben kann. Für einen Zähler bevorzugt man `FieldValue.increment()`
(kommutativ, also konfliktfrei); für den Rest entscheidet ein `updatedAt` mit
`FieldValue.serverTimestamp()` zum Zeitpunkt der Synchronisierung. Wenn die Geschäftsregel
komplexer ist, übernimmt eine Transaktion in einer Cloud Function die Entscheidung serverseitig.

## Offline testen

Der Offline-Modus wird im Integrationstest geprüft: `firestore.disableNetwork()` erzwingt die
Trennung vom Netzwerk, dann spielt `enableNetwork()` die Warteschlange erneut ab. Der
[Firestore-Offline-Guide](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
dokumentiert jede API.

> Eine Offline-First-App wird so konzipiert, als ob das Netzwerk **nicht existieren würde**. Die Synchronisierung ist
> dann nur ein Implementierungsdetail, keine Behandlung eines Ausfalls.
