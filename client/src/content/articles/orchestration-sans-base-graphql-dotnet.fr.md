Dans un backend .NET découpé en microservices, l'accès aux données finit souvent par se disperser.
Les services qui portent l'orchestration attaquent aussi les bases : chacun connaît un bout de
schéma, et changer une table oblige à retrouver tous ceux qui la lisent.

Un découpage en deux étages traite ce point. Un étage possède la donnée, l'autre l'orchestre sans
jamais toucher aux bases du domaine. Reste à relier les deux, et les requêtes GraphQL écrites à la
main deviennent alors le maillon fragile.

## Deux étages, deux responsabilités

Le premier étage possède la donnée. Nommons-le **SystemAPI**. Un service de ce type est
propriétaire d'un seul contexte métier : sa base et son schéma. Il expose ce qu'il détient, et
c'est le seul étage autorisé à ouvrir une connexion vers une base.

Le second étage porte l'orchestration métier. Nommons-le **ProcessAPI**. Il ne possède aucune donnée
métier et n'ouvre de connexion vers aucune base du domaine. Quand une opération a besoin de données,
il interroge les SystemAPI concernés et compose le résultat en mémoire.

« Sans base de données » veut dire sans base *métier*, pas sans état. Le ProcessAPI garde un état
opérationnel bien réel : un cache pour ne pas reposer deux fois la même question à un SystemAPI, un
magasin d'idempotence qui empêche un appel rejoué de relancer une orchestration déjà lancée, et
l'état des orchestrations en cours. Aucun de ces éléments n'est de la donnée du domaine ; ils
tracent seulement où en est chaque orchestration. C'est la question qu'un lecteur se pose dès le
titre, autant y répondre tout de suite.

La contrainte est nette : un SystemAPI par contexte, une base par SystemAPI, et aucun accès direct
depuis le ProcessAPI. Le service Catalog possède les produits, Orders les commandes, Customers les
clients. Une commande qui a besoin du nom d'un client ne lit pas la table clients : elle le demande
au service Customers.

## Ce que la séparation achète

Quand l'orchestration parle aux bases directement, la connaissance du schéma déborde. Plusieurs
services finissent par lire la même table, chacun à sa façon, et une migration devient une chasse
aux appelants. Les décisions de stockage remontent jusque dans le code métier, qui traîne alors des
`DbContext`, des chaînes de connexion et des soucis de transaction qui ne le regardent pas.

Isoler la donnée dans un SystemAPI dédié rend chaque table à un propriétaire unique. Une seule
équipe, un seul chemin de migration, un seul endroit où le schéma change. Le ProcessAPI, lui, ne
connaît que des contrats : il ignore quel moteur de stockage vit derrière, et un SystemAPI peut
passer de SQL à autre chose sans qu'une ligne d'orchestration bouge.

Les deux étages évoluent aussi à des rythmes différents. Un SystemAPI massivement lu se réplique de
son côté, un ProcessAPI gourmand en calcul se dimensionne du sien.

## GraphQL à la frontière de lecture

Un ProcessAPI veut rarement une entité entière. Il veut quelques champs, parfois une branche
imbriquée, taillés pour une orchestration précise. Une API REST impose une représentation figée :
soit elle renvoie trop, soit il faut multiplier les endpoints pour couvrir chaque forme de lecture.

GraphQL laisse l'appelant décrire la forme dont il a besoin, par appel : les champs voulus, les
collections imbriquées, en un seul aller-retour. Une commande et ses lignes reviennent ensemble,
sans deuxième requête. Côté SystemAPI, [HotChocolate](https://chillicream.com/docs/hotchocolate)
transforme le service en serveur GraphQL et fournit les conventions de filtrage (`where`) sans code
à écrire.

Le procédé a ses limites, et les ignorer se paie. La mise en cache HTTP, gratuite en REST, demande
ici un vrai effort : les requêtes passent en `POST` et le corps est opaque aux couches
intermédiaires. Un résolveur naïf déclenche vite des lectures en cascade (le fameux N+1), que le
`DataLoader` de HotChocolate regroupe en lot. Et une frontière GraphQL exposée sans borne de
complexité invite les requêtes profondes et coûteuses ; il faut plafonner la profondeur et le coût
d'une requête comme on plafonnerait une pagination.

## Le maillon fragile : la requête en chaîne de caractères

Reste à envoyer la requête. Un client typé par SystemAPI, via [Refit](https://github.com/reactiveui/refit)
par exemple, porte l'appel HTTP de façon sûre : l'URL, les en-têtes, la désérialisation de la
réponse. Mais le corps de la requête GraphQL, lui, reste une chaîne de caractères.

```csharp
// Hand-built query string: none of these field names is checked against the C# model.
var region = "north";
var query =
    "{ customers(where: { region: { eq: \"" + region + "\" } }) " +
    "{ id name emial orders { total } } }";  // 'emial' compiles fine, fails at runtime
```

Cette chaîne compile même avec une faute de frappe. Rien ne la confronte au modèle C# : un champ
renommé côté modèle continue de pointer vers l'ancien nom jusqu'à l'exécution. Interpoler une valeur
de filtre à la main ouvre la porte aux problèmes d'échappement. Et l'éditeur n'aide en rien, puisque
tout se joue dans du texte opaque.

## Construire la requête depuis le modèle

L'alternative est de bâtir la requête à partir d'expressions typées contre le modèle. La sélection
des champs passe par des accès de membres, le filtrage par des prédicats à la façon de LINQ,
traduits en clauses `where`. Le compilateur vérifie l'ensemble : renommer un champ casse la
compilation au lieu de casser la production, et l'autocomplétion guide la sélection au lieu de la
laisser deviner.

C'est le motif que j'ai fini par extraire dans une bibliothèque, [FluentGraphQL](https://github.com/Nayruuu/FluentGraphQL).
Elle construit requêtes et mutations depuis des expressions C#, avec des filtres `.Where(x => …)`
traduits en `where` typé. On compose l'objet exact voulu : les scalaires d'un coup ou un par un, les
branches imbriquées seulement quand on les demande.

```csharp
// A read, composed from expressions typed against Customer.
// Rename a field on the model and this line stops compiling instead of failing in production.
var query = new GraphQLQueryObject<Customer>("customers")
    .AddEveryFields()                          // every scalar the model declares
    .AddCollectionField(c => c.Orders)         // add the nested branch you need, nothing more
    .Where(c => activeRegions.Contains(c.Region));

builder.AddQuery(query);
```

Le choix d'implémentation compte pour le démarrage à froid. Compiler un lambda en délégué à
l'exécution passe par `Reflection.Emit`, que le *trimming* et Native AOT interdisent. Un générateur
de source déplacerait ce travail au build, au prix d'un générateur à maintenir et de code émis à
embarquer.

FluentGraphQL prend une troisième voie : elle lit les noms de champs via `[CallerArgumentExpression]`
et analyse un seul arbre d'expression par requête, sans jamais le compiler. Aucun IL émis à faire
passer par le JIT, aucune assembly générée à charger : le coût de démarrage reste plat et le chemin
reste compatible Native AOT. La bibliothèque tient sur une seule dépendance d'exécution,
`System.Text.Json`. Le paquet est sur [NuGet](https://www.nuget.org/packages/FluentGraphQL) et la
[documentation](https://nayruuu.github.io/FluentGraphQL/) déroule le reste de l'API.

## Composer un récapitulatif de commande

Un exemple rend la mécanique concrète. Le ProcessAPI doit renvoyer le récapitulatif d'une commande :
la commande et ses lignes, le nom du client, et le libellé de chaque produit commandé. Cela met en
jeu trois contextes, donc trois SystemAPI.

```csharp
// Orders read for the summary: the order and its line items in one round-trip.
var order = new GraphQLQueryObject<Order>("orders")
    .AddEveryFields()                          // id, status, total, ...
    .AddCollectionField(o => o.Lines)          // nested line items, same query
    .Where(o => o.Id == orderId);

builder.AddQuery(order);
```

Le ProcessAPI commence par le service Orders : il lit la commande et ses lignes en un appel. Les
lignes portent des identifiants de produits et un identifiant de client, pas leurs libellés.

À partir de là, deux lectures indépendantes partent en parallèle : le service Customers pour le nom
et l'adresse du client, le service Catalog pour les libellés des produits cités. Aucune ne dépend du
résultat de l'autre, donc rien n'oblige à les enchaîner.

Une fois les trois réponses revenues, le ProcessAPI assemble le récapitulatif en mémoire : il
recolle chaque ligne à son libellé, attache les informations client, et renvoie l'objet façonné pour
l'appelant. À aucun moment il n'a ouvert de connexion vers une base métier.

## Résilience : dépendre de plusieurs services

Ce récapitulatif tient à trois services debout en même temps. La disponibilité d'une orchestration
devient le produit des disponibilités de ses dépendances, et ce produit descend vite.

Chaque appel sortant porte donc un délai maximal. Un SystemAPI lent ne doit pas figer l'orchestration
entière : passé son délai, l'appel est abandonné. Les échecs transitoires méritent une poignée de
réessais, bornés et espacés, sûrs pour des lectures idempotentes. Un disjoncteur coupe le trafic
vers un service qui échoue en série, pour cesser de le marteler et lui laisser le temps de revenir.
En .NET, [Polly](https://www.pollydocs.org/) réunit ces stratégies dans une pile de résilience
posée sur le client typé.

Reste la panne partielle. Si Catalog ne répond pas mais qu'Orders et Customers répondent, le
ProcessAPI décide : échouer franchement, ou rendre un récapitulatif dégradé, avec les identifiants
de produits à la place des libellés. Cette décision est métier, pas technique, et elle se prend
service par service.

## Les compromis qu'on accepte

Le découpage retire une garantie que la base unique offrait gratuitement : la transaction. Une
orchestration qui écrit dans Orders puis dans Customers ne dispose d'aucun commit atomique entre les
deux. Si la seconde écriture échoue, la première est déjà passée, et il faut une compensation
explicite pour revenir en arrière.

C'est précisément pourquoi l'état d'orchestration doit être durable. La séquence des étapes, ce qui
a réussi et ce qui reste à défaire, ne peut pas vivre en mémoire : un redémarrage du ProcessAPI
l'effacerait au pire moment. En .NET sur Azure, les [Durable Functions](https://learn.microsoft.com/azure/azure-functions/durable/)
persistent cet état de saga et rejouent l'orchestration là où elle s'était arrêtée, ce qui donne un
point d'ancrage concret pour piloter le flux de compensation.

Les lectures composées portent la même marque. Le récapitulatif recolle des données venues de trois
services à trois instants voisins mais distincts ; entre-temps, le client a pu changer d'adresse. La
cohérence est éventuelle, pas immédiate, et l'orchestration doit vivre avec.

S'ajoutent le coût des sauts réseau, qui remplace une jointure locale par plusieurs allers-retours,
et une surface d'exploitation plus large, avec plus de services à déployer et à surveiller. Ces
coûts restent supportables, à condition de les avoir choisis en connaissance de cause.

## Tester une orchestration sans base

Le versant agréable de la séparation apparaît au test. Vérifier la composition ne demande aucune
base de domaine à provisionner : le ProcessAPI ne lit pas de tables métier, et ses dépendances de
lecture sont des clients typés, c'est-à-dire des interfaces.

Un test de la logique de composition substitue à ces interfaces des doublures qui renvoient des
graphes préparés pour le scénario visé, puis vérifie que le récapitulatif est bien assemblé, sans
qu'une base métier entre dans la boucle. L'état opérationnel (cache, idempotence, orchestrations) se
teste à part, avec ses propres outils, et les tests d'accès aux données du domaine restent où ils
doivent être, dans chaque SystemAPI, contre son vrai schéma.

## Quand ce découpage est de trop

Deux étages ont un prix. Chaque lecture du ProcessAPI devient un appel réseau vers un SystemAPI : de
la latence, de la sérialisation, et une surface d'exploitation en plus. Pour un service unique posé
sur une base, la séparation ajoute tout ça sans rien rendre en échange. Une application modeste avec
une seule base est plus simple, et plus rapide, en un seul morceau bien rangé.

Le découpage se rentabilise quand il y a plusieurs vrais contextes métier, des courbes de charge qui
divergent, et plusieurs orchestrations qui réutilisent la même donnée possédée ailleurs. En dessous
de ce seuil, un service unique avec une couche d'accès propre suffit.

La partie requête typée, elle, tient debout toute seule. Dès qu'un bout de code C# envoie du GraphQL
à un serveur, quel que soit le nombre d'étages, la construire depuis des expressions plutôt que
depuis une chaîne fait gagner ce que le compilateur sait vérifier.

> Le découpage garde l'orchestration à l'écart du stockage du domaine et rattache chaque jeu de
> données à un propriétaire unique. GraphQL sert de frontière de lecture entre les étages, et bâtir la requête
> depuis des expressions C# supprime la dernière couture non typée : un champ renommé casse la
> compilation, pas la production.
