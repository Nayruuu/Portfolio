On hérite rarement d'un projet vierge. Le plus souvent, c'est un monolithe .NET en production
depuis huit ans, que personne ne relit d'un bloc et que l'équipe redoute de toucher. Le réflexe
est d'en réclamer la réécriture complète. Le pattern **Strangler Fig**, décrit par
[Martin Fowler](https://martinfowler.com/bliki/StranglerFigApplication.html), propose l'inverse :
entourer le monolithe, puis le remplacer une fonctionnalité à la fois, jusqu'à ce qu'il ne reste
plus rien à éteindre.

## Pourquoi pas une réécriture d'un bloc

La réécriture complète vise une cible mobile. Pendant les mois où l'équipe reconstruit, le
monolithe continue de livrer des correctifs et des fonctionnalités que la nouvelle version devra
rattraper avant même d'exister.

Le jour du basculement, tout part en même temps. La moindre régression touche l'ensemble du
produit, et le retour en arrière signifie redéployer l'ancien système entier.

Le strangler déplace le risque. Au lieu d'une bascule unique et irréversible, on obtient une
suite de petites bascules, chacune limitée à une route, chacune annulable. La réécriture n'avance
pas plus vite, mais elle produit de la valeur à chaque étape sans jamais mettre le produit entier
en jeu.

## La façade d'abord

Avant d'extraire quoi que ce soit, on place un point d'interception devant le monolithe. Un
reverse proxy reçoit tout le trafic et le renvoie, pour l'instant, à l'ancien code sans exception.
Fonctionnellement, ce premier déploiement ne change rien, et c'est justement ce qui le rend sûr à
livrer.

Ce point d'interception est la pièce maîtresse du pattern. Tant qu'il n'existe pas, dévier une
route oblige à modifier le monolithe lui-même. Une fois en place, la bascule d'une fonctionnalité
tient dans une ligne de configuration, sans recompiler l'ancien code.

En .NET, [YARP](https://microsoft.github.io/reverse-proxy/) tient ce rôle dans le processus,
piloté par configuration. La route la plus spécifique l'emporte : `/orders/...` part vers le
nouveau service, le fourre-tout renvoie le reste au monolithe.

```json
{
  "ReverseProxy": {
    "Routes": {
      "orders-v2": { "ClusterId": "orders-service", "Match": { "Path": "/orders/{*rest}" } },
      "legacy":    { "ClusterId": "monolith",       "Match": { "Path": "/{*rest}" } }
    },
    "Clusters": {
      "orders-service": { "Destinations": { "d1": { "Address": "https://orders.internal/" } } },
      "monolith":       { "Destinations": { "d1": { "Address": "https://legacy.internal/" } } }
    }
  }
}
```

## Choisir la première couture

Toutes les fonctionnalités ne sont pas de bons candidats pour la première extraction. On cherche
un **contexte borné** au sens de [Domain-Driven Design](https://martinfowler.com/bliki/BoundedContext.html) :
un ensemble cohérent, avec une frontière nette et peu de dépendances qui le traversent.

Le bon premier candidat est faiblement couplé au reste : peu de tables partagées, peu d'appels
croisés avec le cœur du monolithe. Il fait aussi mal quelque part, soit parce qu'il change
souvent, soit parce qu'il porte une charge que l'ancien code encaisse mal.

On évite l'inverse, le module central que tout le monde appelle ou la table sur laquelle la moitié
des requêtes font une jointure. On extrait rarement la facturation en premier. On commence par une
couture périphérique où l'échec se contient : un catalogue en lecture, un service de
notifications, un export.

## L'anti-corruption layer

Le nouveau service ne doit jamais parler le langage du legacy. Colonnes en majuscules, codes
statut numériques, dates sans fuseau : ces choix hérités ne doivent pas franchir la frontière et
contaminer le modèle neuf. On interpose une **anti-corruption layer**, un terme d'Eric Evans, dont
le seul travail est de traduire d'un monde vers l'autre.

Concrètement, c'est une couche à l'entrée du service. Elle prend le DTO tel que le monolithe le
produit et le convertit en un modèle de domaine propre, avec ses types forts.

```csharp
// Translates the legacy contract into the new domain model. Nothing past this
// point knows the monolith's column names, status codes or naked timestamps.
public sealed class LegacyOrderTranslator
{
    public Order ToDomain(LegacyOrderDto dto) => new(
        Id: new OrderId(dto.ORDER_ID),
        Status: MapStatus(dto.STATUS_CODE),
        Total: Money.FromCents(dto.TOTAL_CENTS, dto.CURRENCY),
        PlacedAt: DateTime.SpecifyKind(dto.DT, DateTimeKind.Utc));

    private static OrderStatus MapStatus(int code) => code switch
    {
        10 => OrderStatus.Pending,
        20 => OrderStatus.Paid,
        30 => OrderStatus.Shipped,
        _ => throw new UnknownLegacyStatusException(code),
    };
}
```

La traduction va dans les deux sens tant que le monolithe reste source de vérité : le service lit
du legacy, applique sa logique, puis réécrit dans le format que l'ancien code attend. Cette couche
est aussi le seul endroit à connaître les bizarreries de l'ancien schéma. Le jour où le legacy
disparaît, on supprime le traducteur et rien d'autre ne bouge.

## Migrer la propriété des données

C'est l'étape que le proxy ne résout pas. Router une requête est simple ; déplacer la donnée
qu'elle lit et écrit l'est beaucoup moins.

Au début, le service extrait partage souvent la base du monolithe. Il lit et écrit les mêmes
tables, ce qui évite toute synchronisation mais fait cohabiter deux bases de code sur la même
donnée. C'est un état transitoire, acceptable le temps de stabiliser la route, pas une
destination.

La cible est que la couture possède ses données. Le service reçoit son propre stock et l'une des
deux écritures devient la référence. Pour tenir la cohérence pendant la transition, on écrit des
deux côtés (double écriture), ou, plus sûr, on publie les changements du monolithe via un outbox
ou de la capture de données modifiées (CDC) que le nouveau service consomme.

## Basculer, puis mesurer

Une route ne passe pas d'un coup à 100 % du trafic. On commence par un **canari** : une petite
fraction des requêtes part vers le nouveau service, le reste continue sur le monolithe. Si les
erreurs et les latences tiennent, on augmente la part, jusqu'à couper l'ancienne route.

Avant de couper, on veut la preuve que le nouveau chemin répond comme l'ancien. Le trafic miroir
(shadow traffic) envoie la même requête aux deux implémentations, sert la réponse du monolithe à
l'utilisateur, et compare celle du nouveau service en arrière-plan sans jamais l'exposer.

```csharp
// Shadow the request to the new service, keep serving the monolith's answer,
// and log any divergence for offline review. The user never sees v2 yet.
var legacy = await _monolith.GetOrderAsync(id, ct);

_ = Task.Run(async () =>
{
    var candidate = await _ordersV2.GetOrderAsync(id, ct);
    if (!OrderComparer.Equivalent(legacy, candidate))
    {
        _log.LogWarning("Shadow divergence on order {Id}", id);
    }
});

return legacy;
```

Les divergences remontées par ce comparatif forment la liste de tâches avant la bascule. Quand
elle se vide, le canari peut monter sans pari.

## Retirer l'ancien chemin

Une fonctionnalité migrée laisse derrière elle du code legacy qui ne sert plus. La tentation est
de le garder au cas où. C'est ainsi qu'un monolithe étranglé finit avec deux implémentations de
tout, aucune supprimée.

La règle : on ne retire un chemin que **mort prouvé**. La télémétrie du proxy dit combien d'appels
transitent encore par l'ancienne route. Tant que le compteur n'est pas à zéro sur une fenêtre
représentative, le code reste. Une fois à zéro, on supprime la route legacy, puis le code qu'elle
servait, puis les colonnes que plus personne ne lit.

Le monolithe rétrécit à chaque couture retirée. Le pattern se termine de lui-même : quand la
dernière route a basculé, il ne reste rien à router vers l'ancien processus, et on l'éteint.

> Le strangler n'accélère pas la réécriture, il la rend réversible. Chaque étape livre une couture
> derrière le proxy, se valide sous trafic miroir et s'annule en une ligne de configuration. Le
> risque n'est plus concentré sur une seule bascule, il s'étale sur une suite de petits pas dont
> chacun peut échouer sans emporter le produit.
