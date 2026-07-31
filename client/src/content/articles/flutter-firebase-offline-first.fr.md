Sur mobile, la connectivité n'est jamais acquise : métro, ascenseur, avion. Une app
**offline-first** traite le hors-ligne comme l'état normal, pas comme une erreur : le réseau
n'est qu'une optimisation. Avec Flutter et Firebase, c'est presque gratuit.

## Firestore est offline-first par défaut

Le SDK Firestore garde un cache local persistant et **sert les lectures depuis ce cache**
quand le réseau manque. Sur mobile c'est activé par défaut ; on peut le régler explicitement :

```dart
FirebaseFirestore.instance.settings = const Settings(
  persistenceEnabled: true,
  cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
);
```

### Les écritures sont mises en file

Une écriture hors-ligne n'échoue pas : elle rejoint une **file d'attente** locale, rejouée
dès le retour du réseau. L'UI peut afficher la donnée tout de suite (lecture optimiste) grâce
au drapeau `hasPendingWrites` exposé dans les métadonnées du snapshot :

```dart
stream.listen((snapshot) {
  final source = snapshot.metadata.hasPendingWrites ? 'local' : 'serveur';
  // show a "syncing" badge while source == 'local'
});
```

## Résoudre les conflits

Deux appareils peuvent modifier le même document hors-ligne. Par défaut, **last-write-wins**,
ce qui peut écraser une donnée. Pour un compteur, on préfère `FieldValue.increment()`
(commutatif, donc sans conflit) ; pour le reste, un `updatedAt` en
`FieldValue.serverTimestamp()` tranche au moment de la synchro. Quand la règle métier est
plus complexe, une transaction dans une Cloud Function fait l'arbitrage côté serveur.

## Tester le hors-ligne

Le hors-ligne se teste en intégration : `firestore.disableNetwork()` force le mode
déconnecté, puis `enableNetwork()` rejoue la file. Le
[guide offline Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
documente chaque API.

> Une app offline-first est conçue comme si le réseau **n'existait pas**. La synchro n'est
> alors qu'un détail d'implémentation, pas la gestion d'une panne.
