On mobile, connectivity is never guaranteed: subway, elevator, plane. An **offline-first**
app treats offline as the normal state, not as an error: the network is just an optimization.
With Flutter and Firebase, it's almost free.

## Firestore is offline-first by default

The Firestore SDK keeps a persistent local cache and **serves reads from this cache** when
the network is unavailable. On mobile this is enabled by default; it can be set explicitly:

```dart
FirebaseFirestore.instance.settings = const Settings(
  persistenceEnabled: true,
  cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
);
```

### Writes are queued

An offline write doesn't fail: it joins a local **queue**, replayed as soon as the network
returns. The UI can display the data right away (optimistic read) thanks to the
`hasPendingWrites` flag exposed in the snapshot metadata:

```dart
stream.listen((snapshot) {
  final source = snapshot.metadata.hasPendingWrites ? 'local' : 'server';
  // show a "syncing" badge while source == 'local'
});
```

## Resolving conflicts

Two devices can modify the same document offline. By default, **last-write-wins**, which
can overwrite data. For a counter, `FieldValue.increment()` is preferable (commutative, so
conflict-free); for everything else, an `updatedAt` set via `FieldValue.serverTimestamp()`
settles it at sync time. When the business rule is more complex, a transaction in a Cloud
Function handles the arbitration server-side.

## Testing offline behavior

Offline behavior is tested in integration: `firestore.disableNetwork()` forces disconnected
mode, then `enableNetwork()` replays the queue. The
[Firestore offline guide](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
documents every API.

> An offline-first app is designed as if the network **didn't exist**. Syncing is then just
> an implementation detail, not the handling of an outage.
