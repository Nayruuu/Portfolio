Firestore's offline-first behavior in Flutter is a batch translation task, not a coding one — no skill applies here.

---

## Firestore hors ligne sur Flutter : le cache local comme source de vérité

A mobile connection can drop without warning, and an app that treats every disconnection as an
error becomes unusable the moment you go down into a parking garage. The **offline-first**
approach reverses the starting assumption: the UI reads from and writes to a local store, and
the network only serves to propagate those changes when it's available. Firestore adopts this
model natively, which means most of the work is already done on Flutter mobile. What's left
mostly consists of not undoing it.

## The local cache, source of truth for the UI

The Firestore SDK keeps a persistent local cache, and every read goes through it first. A
`get()` or `snapshots()` returns the cached data immediately, then an update arrives if the
server differs. The UI never waits on the network to display something.

On Android and iOS, this persistence is enabled by default. On the web it isn't: you need an
explicit opt-in, and that's where the configuration matters.

```dart
FirebaseFirestore.instance.settings = const Settings(
  // On mobile this is already on; the web needs the explicit opt-in.
  cache: PersistentCacheSettings(
    sizeBytes: Settings.CACHE_SIZE_UNLIMITED,
  ),
);
```

`PersistentCacheSettings` replaces the old `persistenceEnabled` and `cacheSizeBytes` fields,
still accepted but deprecated. The cache has a size cap by default: Firestore evicts the least
recently used documents once the limit is reached, and `CACHE_SIZE_UNLIMITED` removes it. A
one-off read can also force its source with `GetOptions(source: Source.cache)` or
`Source.server`, the default `serverAndCache` falling back to the cache if the server doesn't
respond.

## Writes go into a queue

An offline write doesn't fail and doesn't block. `set`, `update`, `delete` and `WriteBatch` join
a local queue, applied to the cache immediately and replayed to the server once the network
returns. Listeners attached to the document fire right away with the new value: this is what
gives an optimistic UI without having to write rollback code.

The queue survives a restart: a write made offline, with the app killed right after, will still
be synced on the next connected launch. `waitForPendingWrites()` returns a `Future` that
completes once the queue drains, handy for an "everything is synced" indicator or to sequence a
test.

This head start has a counterpart: the write is applied to the cache before any server
validation. If security rules reject it during sync, Firestore removes it from the cache and
listeners revert to the previous value. The optimistic UI must therefore stay reversible at
render time, without a definitive side effect triggered on the sole faith of the local write.

## Reading the snapshot metadata

Every snapshot carries a `SnapshotMetadata` with two flags. `isFromCache` indicates that the
data comes from the local cache and not from a server response. `hasPendingWrites` indicates
that a local write is still waiting for confirmation. Together they describe a document's exact
sync state.

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

A trap lives in this code: by default, a stream doesn't re-emit when only the metadata changes.
Without `includeMetadataChanges: true`, the transition of `hasPendingWrites` to `false` (the
write confirmed by the server) triggers no event, and the "syncing" badge never clears.

## Connectivity informs the display

It's tempting to cut Firestore off when a network monitor reports no connection. That's a
mistake. The [connectivity_plus package](https://pub.dev/packages/connectivity_plus) reports the
interface state (wifi, mobile data, none), not actual reachability: a wifi signal with no
internet access still answers "connected". Firestore manages its own connection, its
reconnections and its queue; letting it do so is the correct behavior.

Connectivity remains useful for display purposes: an offline banner, a button greyed out when
its action needs the server. It informs the rendering, it shouldn't gate the Firestore calls
themselves.

## Conflicts: last-write-wins by default

Two devices modify the same document offline, then sync. By default, the last write to reach
the server wins, field by field, and can overwrite an intermediate value.

For a counter, `FieldValue.increment()` sidesteps the problem: the operation is commutative, so
increments replayed from several devices add up instead of clobbering each other. To settle
concurrent updates, an `updatedAt` field with `FieldValue.serverTimestamp()` gives a
deterministic order, the timestamp being set by the server at sync time, not by the phone's
clock.

```dart
// Commutative: replays from several devices add up instead of clobbering.
await ref.update({'views': FieldValue.increment(1)});

// Server-stamped at sync time, not from the device clock.
await ref.update({'updatedAt': FieldValue.serverTimestamp()});
```

These sentinels have a limitation on the cache side: until the server has confirmed,
`serverTimestamp()` reads as `null` in the local cache, which needs to be handled in the
display.

When the business rule requires reading before writing (debiting a balance, reserving stock),
`runTransaction` is the right tool, but it doesn't work offline: a transaction requires a
round-trip to the server, it isn't queued and fails if the network is missing. This is
intentional, since a transaction can't guarantee its invariant on a cache that might be stale.
The logic that can't tolerate last-write-wins therefore lives server-side, in the transaction or
a Cloud Function, and waits for the connection.

## Testing offline behavior

Offline behavior can be verified without manually cutting the wifi. `disableNetwork()` forces
disconnected mode, writes pile up in the queue, `enableNetwork()` replays it.

```dart
final db = FirebaseFirestore.instance;
await db.disableNetwork();

await docRef.update({'title': 'edited offline'}); // queued, not sent
// assert the local listener already reflects 'edited offline'

await db.enableNetwork();
await db.waitForPendingWrites(); // completes once the queue drains
```

The [Firestore offline guide](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
details every API: cache, read source, metadata and network toggling.

> With Firestore, the offline infrastructure is already in place: persistent cache, write
> queue, automatic sync on network return. The work of an offline-first app mostly comes down
> to trusting the local cache for both reads and writes, and not reflexively putting the
> network back at the center.
