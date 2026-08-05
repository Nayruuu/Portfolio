Una conexión móvil se cae sin avisar, y una app que trata cada corte como un
error se vuelve inutilizable en cuanto se baja a un aparcamiento. El enfoque **offline-first**
invierte la hipótesis de partida: la UI lee y escribe en un almacén local, la red solo sirve
para propagar esos cambios cuando está disponible. Firestore adopta este modelo de forma
nativa, lo que deja gran parte del trabajo ya hecho en Flutter mobile. El resto consiste sobre
todo en no deshacerlo.

## La caché local, fuente de verdad de la UI

El SDK de Firestore mantiene una caché local persistente, y cada lectura pasa primero por ella.
Un `get()` o un `snapshots()` devuelve el dato en caché de inmediato, y luego llega una
actualización si el servidor difiere. La UI nunca espera a la red para mostrar algo.

En Android e iOS, esta persistencia está activada por defecto. En web no lo está: hay que
activarla explícitamente, y ahí es donde importa la configuración.

```dart
FirebaseFirestore.instance.settings = const Settings(
  // On mobile this is already on; the web needs the explicit opt-in.
  cache: PersistentCacheSettings(
    sizeBytes: Settings.CACHE_SIZE_UNLIMITED,
  ),
);
```

`PersistentCacheSettings` sustituye a los antiguos campos `persistenceEnabled` y
`cacheSizeBytes`, todavía aceptados pero obsoletos. La caché tiene un tamaño limitado por
defecto: Firestore expulsa los documentos usados menos recientemente cuando se alcanza el
límite, y `CACHE_SIZE_UNLIMITED` elimina ese límite. Una lectura puntual también puede forzar
su procedencia con `GetOptions(source: Source.cache)` o `Source.server`, mientras que el valor
por defecto `serverAndCache` recae en la caché si el servidor no responde.

## Las escrituras entran en una cola

Una escritura sin conexión no falla ni bloquea. `set`, `update`, `delete` y los `WriteBatch`
se suman a una cola local, se aplican a la caché de inmediato y se reproducen hacia el
servidor en cuanto vuelve la red. Los listeners asociados al documento se disparan
enseguida con el nuevo valor: esto es lo que da una UI optimista sin necesidad de escribir
código de rollback.

La cola sobrevive al reinicio: una escritura hecha sin conexión, con la app cerrada justo
después, se sincronizará igualmente en el siguiente arranque conectado. `waitForPendingWrites()`
devuelve un `Future` que se completa cuando la cola queda vacía, útil para un indicador de
«todo sincronizado» o para secuenciar una prueba.

Este adelanto tiene una contrapartida: la escritura se aplica a la caché antes de cualquier
validación por parte del servidor. Si las reglas de seguridad la rechazan al sincronizar,
Firestore la retira de la caché y los listeners vuelven al valor anterior. La UI optimista
debe, por tanto, seguir siendo reversible en el renderizado, sin efectos secundarios
definitivos desencadenados solo por la fe en la escritura local.

## Leer los metadatos del snapshot

Cada snapshot lleva un `SnapshotMetadata` con dos indicadores. `isFromCache` indica que el
dato proviene de la caché local y no de una respuesta del servidor. `hasPendingWrites` indica
que una escritura local todavía espera confirmación. Juntos describen el estado exacto de
sincronización de un documento.

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

Una trampa vive en este código: por defecto, un stream no vuelve a emitir cuando solo cambian
los metadatos. Sin `includeMetadataChanges: true`, el paso de `hasPendingWrites` a `false`
(la escritura confirmada por el servidor) no dispara ningún evento, y el indicador de
«sincronizando» nunca desaparece.

## La conectividad informa la interfaz

Es tentador cortar Firestore cuando un monitor de red señala la ausencia de conexión. Es un
error. El [paquete connectivity_plus](https://pub.dev/packages/connectivity_plus) informa
del estado de la interfaz (wifi, datos móviles, ninguna), no de la accesibilidad real: un
wifi captado sin acceso a internet responde «conectado». Firestore gestiona su propia
conexión, sus reconexiones y su cola; dejarlo hacer es el comportamiento correcto.

La conectividad sigue siendo útil para la interfaz: un banner sin conexión, un botón
deshabilitado cuando su acción necesita el servidor. Informa el renderizado, pero no debe
condicionar las llamadas a Firestore en sí.

## Conflictos: last-write-wins por defecto

Dos dispositivos modifican el mismo documento sin conexión, y luego se sincronizan. Por
defecto, gana la última escritura que llega al servidor, campo por campo, y puede sobrescribir
un valor intermedio.

Para un contador, `FieldValue.increment()` evita el problema: la operación es conmutativa,
por lo que los incrementos reproducidos desde varios dispositivos se suman en lugar de
sobrescribirse. Para desempatar actualizaciones concurrentes, un campo `updatedAt` con
`FieldValue.serverTimestamp()` da un orden determinista, ya que la marca de tiempo la pone el
servidor en el momento de la sincronización, no el reloj del teléfono.

```dart
// Commutative: replays from several devices add up instead of clobbering.
await ref.update({'views': FieldValue.increment(1)});

// Server-stamped at sync time, not from the device clock.
await ref.update({'updatedAt': FieldValue.serverTimestamp()});
```

Estos centinelas tienen un límite en el lado de la caché: mientras el servidor no lo haya
confirmado, `serverTimestamp()` se lee como `null` en la caché local, algo que hay que
gestionar en la interfaz.

Cuando la regla de negocio exige leer antes de escribir (debitar un saldo, reservar stock),
`runTransaction` es la herramienta adecuada, pero no funciona sin conexión: una transacción
exige un viaje de ida y vuelta al servidor, no se encola y falla si falta la red. Esto es
intencionado, ya que una transacción no puede garantizar su invariante sobre una caché
quizá desactualizada. La lógica que no tolera el last-write-wins vive, por tanto, en el lado
del servidor, dentro de la transacción o de una Cloud Function, y espera a la conexión.

## Probar el modo sin conexión

El comportamiento sin conexión se verifica sin necesidad de cortar el wifi a mano.
`disableNetwork()` fuerza el modo desconectado, las escrituras se apilan en la cola,
`enableNetwork()` las reproduce.

```dart
final db = FirebaseFirestore.instance;
await db.disableNetwork();

await docRef.update({'title': 'edited offline'}); // queued, not sent
// assert the local listener already reflects 'edited offline'

await db.enableNetwork();
await db.waitForPendingWrites(); // completes once the queue drains
```

La [guía offline de Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
detalla cada API: caché, fuente de lectura, metadatos y conmutación de red.

> Con Firestore, la infraestructura sin conexión ya está en su sitio: caché persistente, cola
> de escrituras, sincronización automática al volver la red. El trabajo de una app
> offline-first consiste sobre todo en confiar en la caché local tanto para leer como para
> escribir, y en no devolver la red al centro por reflejo.
