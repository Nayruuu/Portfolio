En móvil, la conectividad nunca está garantizada: metro, ascensor, avión. Una app
**offline-first** trata el modo sin conexión como el estado normal, no como un error: la red
es solo una optimización. Con Flutter y Firebase, esto es casi gratis.

## Firestore es offline-first por defecto

El SDK de Firestore mantiene una caché local persistente y **sirve las lecturas desde esta caché**
cuando falta la red. En móvil está activado por defecto; se puede configurar explícitamente:

```dart
FirebaseFirestore.instance.settings = const Settings(
  persistenceEnabled: true,
  cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
);
```

### Las escrituras se ponen en cola

Una escritura sin conexión no falla: se une a una **cola** local, que se reproduce
en cuanto vuelve la red. La UI puede mostrar el dato de inmediato (lectura optimista) gracias
al indicador `hasPendingWrites` expuesto en los metadatos del snapshot:

```dart
stream.listen((snapshot) {
  final source = snapshot.metadata.hasPendingWrites ? 'local' : 'servidor';
  // show a "syncing" badge while source == 'local'
});
```

## Resolver los conflictos

Dos dispositivos pueden modificar el mismo documento sin conexión. Por defecto, **last-write-wins**,
lo que puede sobrescribir un dato. Para un contador, se prefiere `FieldValue.increment()`
(conmutativo, por lo tanto sin conflicto); para el resto, un `updatedAt` en
`FieldValue.serverTimestamp()` decide en el momento de la sincronización. Cuando la regla de negocio es
más compleja, una transacción en una Cloud Function arbitra del lado del servidor.

## Probar el modo sin conexión

El modo sin conexión se prueba en integración: `firestore.disableNetwork()` fuerza el modo
desconectado, luego `enableNetwork()` reproduce la cola. La
[guía offline de Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
documenta cada API.

> Una app offline-first se diseña como si la red **no existiera**. La sincronización
> es entonces solo un detalle de implementación, no la gestión de un fallo de red.
