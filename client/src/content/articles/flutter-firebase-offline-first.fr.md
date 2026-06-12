Sur mobile, la connectivité n'est jamais acquise : métro, ascenseur, avion. Une app
**offline-first** ne traite pas le hors-ligne comme une erreur, mais comme l'état normal —
le réseau n'est qu'une optimisation. Avec Flutter et Firebase, c'est presque gratuit.

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
  // afficher un badge « synchro en cours » tant que source == 'local'
});
```

## Résoudre les conflits

Deux appareils modifient le même document hors-ligne : qui gagne ? Par défaut,
**last-write-wins**, ce qui peut écraser une donnée. Pour un compteur, on préfère `FieldValue.increment()`
(commutatif, donc sans conflit) ; pour le reste, un `updatedAt` en
`FieldValue.serverTimestamp()` tranche au moment de la synchro.

- compteurs → `increment()`
- horodatage serveur → `serverTimestamp()`
- règle métier complexe → une transaction dans une Cloud Function

## Tester le hors-ligne

On ne teste pas l'offline « au feeling » : `firestore.disableNetwork()` force le mode
déconnecté dans un test d'intégration, puis `enableNetwork()` rejoue la file. Le
[guide offline Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
documente chaque API.

> L'offline-first, ce n'est pas gérer une panne réseau. C'est concevoir l'app comme si le
> réseau **n'existait pas**, et laisser la synchro n'être qu'un détail d'implémentation.
