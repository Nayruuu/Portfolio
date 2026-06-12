## Firestore es offline-first por defecto

El SDK de Firestore mantiene una caché local persistente y **sirve las lecturas desde esa caché**
cuando no hay red. En móvil está activado por defecto; se puede configurar explícitamente:

```dart
FirebaseFirestore.instance.settings = const Settings(
  persistenceEnabled: true,
  cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
);
```

### Las escrituras se ponen en cola

Una escritura sin conexión no falla: se añade a una **cola** local, que se reproduce en cuanto
vuelve la red. La UI puede mostrar el dato de inmediato (lectura optimista) gracias al indicador
`hasPendingWrites` expuesto en los metadatos del snapshot:

```dart
stream.listen((snapshot) {
  final source = snapshot.metadata.hasPendingWrites ? 'local' : 'serveur';
  // afficher un badge « synchro en cours » tant que source == 'local'
});
```

## Resolver los conflictos

Dos dispositivos modifican el mismo documento sin conexión: ¿quién gana? Por defecto,
**last-write-wins**, lo que puede sobrescribir un dato. Para un contador, se prefiere `FieldValue.increment()`
(conmutativo, por lo tanto sin conflicto); para el resto, un `updatedAt` con
`FieldValue.serverTimestamp()` decide en el momento de la sincronización.

- contadores → `increment()`
- marca de tiempo del servidor → `serverTimestamp()`
- regla de negocio compleja → una transacción en una Cloud Function

## Probar la desconexión

No se prueba el offline «a ojo»: `firestore.disableNetwork()` fuerza el modo desconectado en
una prueba de integración, y luego `enableNetwork()` reproduce la cola. La
[guía offline de Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
documenta cada API.

> El offline-first no consiste en gestionar un fallo de red. Consiste en concebir la app como si la
> red **no existiera**, y dejar que la sincronización sea solo un detalle de implementación.
