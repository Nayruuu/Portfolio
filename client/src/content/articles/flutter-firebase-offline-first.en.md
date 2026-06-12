On mobile, connectivity is never a given: subway, elevator, plane. An **offline-first** app
doesn't treat being offline as an error but as the normal state — the network is merely an
optimization. With Flutter and Firebase, you get it almost for free.

## Firestore is offline-first by default

The Firestore SDK keeps a persistent local cache and **serves reads from it** when the
network is gone. On mobile it's on by default; you can set it explicitly:

```dart
FirebaseFirestore.instance.settings = const Settings(
  persistenceEnabled: true,
  cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
);
```

### Writes are queued

An offline write doesn't fail: it joins a local **queue**, replayed as soon as the network
returns. The UI can show the data right away (optimistic read) thanks to the
`hasPendingWrites` flag exposed in the snapshot metadata:

```dart
stream.listen((snapshot) {
  final source = snapshot.metadata.hasPendingWrites ? 'local' : 'server';
  // show a "syncing" badge while source == 'local'
});
```

## Resolving conflicts

Two devices edit the same document offline: who wins? By default, **last-write-wins**, which
can clobber data. For a counter, prefer `FieldValue.increment()` (commutative, hence
conflict-free); for everything else, an `updatedAt` set to `FieldValue.serverTimestamp()`
decides at sync time.

- counters → `increment()`
- server clock → `serverTimestamp()`
- complex business rule → a transaction in a Cloud Function

## Testing offline

Don't test offline "by feel": `firestore.disableNetwork()` forces the disconnected mode in an
integration test, then `enableNetwork()` replays the queue. The
[Firestore offline guide](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
documents every API.

> Offline-first isn't about handling a network outage. It's about designing the app as if the
> network **didn't exist**, and letting sync be nothing more than an implementation detail.
