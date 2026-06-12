## Firestore ist standardmäßig Offline-First

Das Firestore-SDK pflegt einen persistenten lokalen Cache und **bedient Lesezugriffe aus diesem Cache**,
wenn kein Netzwerk verfügbar ist. Auf Mobilgeräten ist das standardmäßig aktiviert; es lässt sich
explizit konfigurieren:

```dart
FirebaseFirestore.instance.settings = const Settings(
  persistenceEnabled: true,
  cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
);
```

### Schreibvorgänge werden in eine Warteschlange eingereiht

Ein Schreibvorgang im Offline-Modus schlägt nicht fehl: Er wird in eine lokale **Warteschlange**
eingereiht und bei Netzwiederkehr erneut ausgeführt. Die UI kann die Daten sofort anzeigen
(optimistisches Lesen) dank des Flags `hasPendingWrites`, das in den Metadaten des Snapshots
verfügbar ist:

```dart
stream.listen((snapshot) {
  final source = snapshot.metadata.hasPendingWrites ? 'local' : 'serveur';
  // afficher un badge « synchro en cours » tant que source == 'local'
});
```

## Konflikte auflösen

Zwei Geräte ändern dasselbe Dokument offline: Wer gewinnt? Standardmäßig gilt
**Last-Write-Wins**, was Daten überschreiben kann. Für einen Zähler bevorzugt man `FieldValue.increment()`
(kommutativ, also konfliktfrei); für alles andere entscheidet ein `updatedAt` mit
`FieldValue.serverTimestamp()` zum Zeitpunkt der Synchronisierung.

- Zähler → `increment()`
- Server-Zeitstempel → `serverTimestamp()`
- Komplexe Geschäftsregel → eine Transaktion in einer Cloud Function

## Offline testen

Offline wird nicht „nach Gefühl" getestet: `firestore.disableNetwork()` erzwingt den
Offline-Modus in einem Integrationstest, `enableNetwork()` spielt anschließend die Warteschlange
erneut ab. Der
[Firestore-Offline-Leitfaden](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
dokumentiert jede API.

> Offline-First bedeutet nicht, einen Netzwerkausfall zu behandeln. Es bedeutet, die App so zu
> gestalten, als würde das Netzwerk **nicht existieren**, und die Synchronisierung zu einem bloßen
> Implementierungsdetail werden zu lassen.
