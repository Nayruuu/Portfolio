Une connexion mobile tombe sans prévenir, et une app qui traite chaque coupure comme une
erreur devient inutilisable dès qu'on descend dans un parking. L'approche **offline-first**
inverse l'hypothèse de départ : l'UI lit et écrit dans un magasin local, le réseau ne sert
qu'à propager ces changements quand il est là. Firestore adopte ce modèle nativement, ce qui
place l'essentiel du travail déjà fait sur Flutter mobile. Le reste consiste surtout à ne pas
le défaire.

## Le cache local, source de vérité de l'UI

Le SDK Firestore tient un cache local persistant, et chaque lecture passe d'abord par lui. Un
`get()` ou un `snapshots()` renvoie la donnée en cache tout de suite, puis une mise à jour
arrive si le serveur diffère. L'UI n'attend jamais le réseau pour afficher quelque chose.

Sur Android et iOS, cette persistance est activée par défaut. Sur le web elle ne l'est pas :
il faut l'opt-in explicite, et c'est là que le paramétrage compte.

```dart
FirebaseFirestore.instance.settings = const Settings(
  // On mobile this is already on; the web needs the explicit opt-in.
  cache: PersistentCacheSettings(
    sizeBytes: Settings.CACHE_SIZE_UNLIMITED,
  ),
);
```

`PersistentCacheSettings` remplace les anciens champs `persistenceEnabled` et `cacheSizeBytes`,
toujours acceptés mais dépréciés. Le cache a une taille plafonnée par défaut : Firestore évince
les documents les moins récemment utilisés quand la limite est atteinte, et
`CACHE_SIZE_UNLIMITED` la lève. Une lecture ponctuelle peut aussi forcer sa provenance avec
`GetOptions(source: Source.cache)` ou `Source.server`, la valeur par défaut `serverAndCache`
retombant sur le cache si le serveur ne répond pas.

## Les écritures partent dans une file

Une écriture hors-ligne n'échoue pas et ne bloque pas. `set`, `update`, `delete` et les
`WriteBatch` rejoignent une file d'attente locale, appliquée au cache immédiatement et rejouée
vers le serveur au retour du réseau. Les listeners attachés au document se déclenchent aussitôt
avec la nouvelle valeur : c'est ce qui donne une UI optimiste sans code de rollback à écrire.

La file survit au redémarrage : une écriture faite hors-ligne, l'app tuée juste après, sera
quand même synchronisée au prochain lancement connecté. `waitForPendingWrites()` rend un
`Future` qui se complète une fois la file vidée, pratique pour un indicateur « tout est
synchronisé » ou pour séquencer un test.

Cette avance a une contrepartie : l'écriture est appliquée au cache avant toute validation
serveur. Si les règles de sécurité la rejettent à la synchro, Firestore la retire du cache et
les listeners repassent à l'ancienne valeur. L'UI optimiste doit donc rester réversible au
rendu, sans effet de bord définitif déclenché sur la seule foi de l'écriture locale.

## Lire les métadonnées du snapshot

Chaque snapshot porte un `SnapshotMetadata` avec deux drapeaux. `isFromCache` indique que la
donnée vient du cache local et non d'une réponse serveur. `hasPendingWrites` indique qu'une
écriture locale attend encore sa confirmation. Ensemble ils décrivent l'état de synchro exact
d'un document.

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

Un piège vit dans ce code : par défaut, un stream ne réémet pas quand seules les métadonnées
changent. Sans `includeMetadataChanges: true`, le passage de `hasPendingWrites` à `false`
(l'écriture confirmée par le serveur) ne déclenche aucun événement, et le badge « en cours de
synchro » ne s'efface jamais.

## La connectivité renseigne l'affichage

Il est tentant de couper Firestore quand un moniteur réseau signale l'absence de connexion.
C'est une erreur. Le [paquet connectivity_plus](https://pub.dev/packages/connectivity_plus)
rapporte l'état de l'interface (wifi, données mobiles, aucune), pas la joignabilité réelle :
un wifi capté sans accès internet répond « connecté ». Firestore gère sa propre connexion, ses
reconnexions et sa file ; le laisser faire est le comportement correct.

La connectivité reste utile pour l'affichage : une bannière hors-ligne, un bouton grisé quand
son action a besoin du serveur. Elle informe le rendu, elle n'a pas à conditionner les appels
Firestore eux-mêmes.

## Conflits : last-write-wins par défaut

Deux appareils modifient le même document hors-ligne, puis se synchronisent. Par défaut, la
dernière écriture arrivée au serveur gagne, champ par champ, et peut écraser une valeur
intermédiaire.

Pour un compteur, `FieldValue.increment()` contourne le problème : l'opération est commutative,
donc des incréments rejoués depuis plusieurs appareils s'additionnent au lieu de s'écraser.
Pour départager des mises à jour concurrentes, un `updatedAt` en `FieldValue.serverTimestamp()`
donne un ordre déterministe, l'horodatage étant posé par le serveur au moment de la synchro,
pas par l'horloge du téléphone.

```dart
// Commutative: replays from several devices add up instead of clobbering.
await ref.update({'views': FieldValue.increment(1)});

// Server-stamped at sync time, not from the device clock.
await ref.update({'updatedAt': FieldValue.serverTimestamp()});
```

Ces sentinelles ont une limite côté cache : tant que le serveur n'a pas confirmé,
`serverTimestamp()` se lit comme `null` dans le cache local, à gérer à l'affichage.

Quand la règle métier impose de lire avant d'écrire (débiter un solde, réserver un stock),
`runTransaction` est l'outil adapté, mais il ne fonctionne pas hors-ligne : une transaction
exige un aller-retour serveur, elle n'est pas mise en file et échoue si le réseau manque. C'est
voulu, puisqu'une transaction ne peut pas garantir son invariant sur un cache peut-être périmé.
La logique qui ne tolère pas le last-write-wins vit donc côté serveur, dans la transaction ou
une Cloud Function, et attend la connexion.

## Tester le hors-ligne

Le comportement hors-ligne se vérifie sans couper le wifi à la main. `disableNetwork()` force
le mode déconnecté, les écritures s'empilent dans la file, `enableNetwork()` la rejoue.

```dart
final db = FirebaseFirestore.instance;
await db.disableNetwork();

await docRef.update({'title': 'edited offline'}); // queued, not sent
// assert the local listener already reflects 'edited offline'

await db.enableNetwork();
await db.waitForPendingWrites(); // completes once the queue drains
```

Le [guide offline de Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
détaille chaque API : cache, source de lecture, métadonnées et bascule réseau.

> Avec Firestore, l'infrastructure hors-ligne est déjà en place : cache persistant, file
> d'écritures, synchro automatique au retour du réseau. Le travail d'une app offline-first
> tient surtout à faire confiance au cache local pour lire comme pour écrire, et à ne pas
> remettre le réseau au centre par réflexe.
