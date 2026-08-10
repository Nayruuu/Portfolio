Les [migrations EF Core](https://learn.microsoft.com/ef/core/managing-schemas/migrations/) savent
créer une table. Le modèle décrit les entités, `Add-Migration` compare
l'état voulu à l'état précédent, et la table sort avec ses colonnes et ses index. Les procédures
stockées et les vues n'entrent pas dans ce moule : le modèle ne les connaît pas, et le générateur de
migrations n'a rien à comparer.

Restent deux façons de les faire vivre, toutes deux insatisfaisantes. Écrire le SQL dans une chaîne
C# au milieu d'une migration, ou appliquer les procédures à la main, en dehors des migrations. La
première noie le SQL dans du texte C#. La seconde le laisse dériver hors du contrôle de version.

Une troisième voie existe : garder chaque objet dans un vrai fichier `.sql` versionné, et laisser la
migration l'appliquer.

## Le SQL noyé dans une chaîne C#

La tentation immédiate est de coller le corps de la procédure dans un `migrationBuilder.Sql("…")`.
Ça marche, et ça se dégrade vite.

Une procédure de deux cents lignes devient une chaîne C# de deux cents lignes, sans coloration
syntaxique ni l'outillage d'un éditeur SQL. Les guillemets internes doivent s'échapper, et le `diff`
d'une révision ne montre qu'un bloc de texte remanié que personne ne lit vraiment.

La revue en souffre autant. Un relecteur devant une chaîne géante approuve la forme du C#, pas la
logique SQL qu'elle transporte. Le SQL, la partie qui touche vraiment les données, échappe à la
relecture au moment précis où il faudrait la resserrer.

## Ou appliqué à la main

L'autre réflexe est de sortir les procédures des migrations et de les appliquer à part : un script
lancé après le déploiement, ou pire, une exécution manuelle dans un client SQL.

Le SQL redevient lisible, mais il quitte le fil des migrations. Rien ne garantit qu'il a été
appliqué, ni dans quel ordre par rapport aux changements de schéma dont il dépend. Deux
environnements finissent avec des procédures différentes sans que rien ne le signale. Et l'historique
de qui a changé quoi, que les migrations tiennent naturellement, disparaît.

L'idempotence manque aussi : rejouer le script sur une base déjà à jour peut échouer ou dupliquer un
effet, selon la façon dont il est écrit.

## Un fichier .sql par objet

Le compromis tient les deux bouts : le SQL vit dans un vrai fichier, et la migration reste la voie
d'application.

Chaque objet, procédure, vue ou script de données, devient un fichier `.sql`, rangé par nature à côté
des migrations. Un dossier pour chaque type : `Migrations/Procedures/`, `Migrations/Views/` et
`Migrations/Scripts/` pour les scripts de données ponctuels. Le nom du fichier est celui de l'objet :
`Procedures/GetActiveCustomers.sql`, `Views/CustomerOrderSummary.sql`.

Un détail de build conditionne le reste : ces fichiers doivent accompagner l'assembly à l'exécution.
On les marque en copie vers la sortie dans le `.csproj` (`CopyToOutputDirectory`), ou on les embarque
en ressources. Oublier cette étape donne une migration qui compile et échoue au déploiement, faute de
trouver son fichier.

## La migration exécute le fichier

Une petite extension de `MigrationBuilder` lit le fichier et l'exécute. La migration ne porte plus de
SQL, seulement une référence au fichier.

```csharp
// A MigrationBuilder extension: read a versioned .sql file and run it as one migration step.
public static class SqlFileExtensions
{
    private static readonly string Root =
        Path.Combine(AppContext.BaseDirectory, "Migrations");

    public static void ExecuteSqlFile(this MigrationBuilder builder, string relativePath) =>
        builder.Sql(File.ReadAllText(Path.Combine(Root, relativePath)));

    public static void DropProcedure(this MigrationBuilder builder, string name) =>
        builder.Sql($"DROP PROCEDURE IF EXISTS {name};");
}
```

La même extension expose `DropProcedure` et `DropView` : retirer un objet devenu inutile est aussi un
pas en avant, une migration qui le supprime dans son `Up()`, pas un `Down()` qui l'annule. La
migration qui crée ou modifie une procédure se réduit alors à une ligne.

```csharp
public partial class AddGetActiveCustomers : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.ExecuteSqlFile("Procedures/GetActiveCustomers.sql");

    // Forward-only: a procedure is never "un-altered". A regression ships as a new migration.
    protected override void Down(MigrationBuilder migrationBuilder) { }
}
```

Le déploiement reste ce qu'il était : `dotnet ef database update`, ou la migration jouée au
démarrage. Une seule commande, jouée dans l'ordre, qui laisse une trace de ce qu'elle applique.

## CREATE OR ALTER, l'idempotence par défaut

Le contenu du fichier suit une règle simple : il commence par un en-tête standard et définit l'objet
en `CREATE OR ALTER`.

```sql
-- Procedure: dbo.GetActiveCustomers
-- Applied by EF Core migrations only, never by hand.
CREATE OR ALTER PROCEDURE dbo.GetActiveCustomers
    @Since datetime2
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.Id, c.Name, c.Email
    FROM   dbo.Customers AS c
    WHERE  c.LastOrderedAt >= @Since;
END;
```

`CREATE OR ALTER`, [disponible sur SQL Server depuis 2016](https://learn.microsoft.com/sql/t-sql/statements/create-procedure-transact-sql),
crée l'objet s'il n'existe pas et le remplace sinon, sans le détour `IF EXISTS ... DROP ... CREATE`. Rejouer le fichier sur une base déjà à jour laisse la
procédure identique : l'opération est idempotente par construction, ce qui rend un redéploiement sûr.

Changer la procédure devient banal. On édite son `.sql`, on ajoute une migration qui rappelle
`ExecuteSqlFile` sur le même chemin, et le `diff` git montre exactement les lignes SQL modifiées.
L'historique de la procédure se lit comme celui de n'importe quel fichier source, révision par
révision. Sur PostgreSQL, l'équivalent est `CREATE OR REPLACE` : le principe tient, la syntaxe change.

## Vues et scripts : même rangement, idempotence différente

Les vues suivent exactement les procédures : un fichier par vue, `CREATE OR ALTER VIEW`, re-jouable
sans risque.

Les scripts de données obéissent à une autre règle. Un `CREATE OR ALTER` redéfinit une définition ;
un script qui insère ou corrige des lignes produit un effet, et rejouer cet effet n'est pas neutre.
Ceux-là restent à application unique, et leur idempotence se gère à l'intérieur du script, par une
garde : un `IF NOT EXISTS (...)` autour de l'insertion, une mise à jour conditionnée sur l'état
courant. Le rangement est le même, la sémantique diffère, et il faut savoir laquelle on écrit avant
de la ranger.

## Down() reste vide : la discipline forward-only

Le `Down()` de ces migrations ne fait rien, et c'est délibéré.

Défaire une procédure n'a pas de sens clair. Revenir à sa version précédente supposerait de la
stocker quelque part et de la ré-appliquer, ce que la migration ne fait pas. La discipline est donc
en avant seulement : une procédure fautive n'est pas annulée, elle est corrigée par une nouvelle
version qui part en avant, dans une nouvelle migration.

Cela colle à la façon dont la plupart des équipes déploient une base en production : on avance vers
un état réparé plutôt que de « descendre » un schéma live. Le `Down()` vide énonce cette règle au
lieu de la laisser implicite.

## Ce que la discipline coûte

Le forward-only a un prix direct : aucun rollback automatique d'une procédure. Un mauvais déploiement
se rattrape par une migration corrective, pas par un `Down()`. Il faut donc pouvoir livrer vite une
correction, et tester les procédures avant qu'elles n'atteignent la production.

Le `.sql` vit à côté du modèle C#, mais rien ne les relie au compilateur. Si une colonne est renommée
dans le modèle et sa migration de table, la procédure qui la lit l'ignore. Rien ne compile ce SQL,
c'est du texte, et il casse à l'exécution. La synchronisation entre le SQL des fichiers et les
colonnes qu'il touche reste à la charge de l'auteur et de la revue.

Externaliser n'allège pas le SQL. Une procédure de deux cents lignes reste une procédure de deux
cents lignes ; le motif la range, il ne la raccourcit pas. Et comme EF ne type-vérifie rien de ce
SQL, il demande sa propre rigueur de revue : lire le SQL du fichier, pas seulement la ligne C# qui
l'appelle.

## Le filet : des tests contre un vrai moteur

Puisque rien ne vérifie ce SQL à la compilation, le filet se place à l'exécution, dans les tests. Une
procédure se teste comme du code : les migrations s'appliquent à une base jetable, puis un appel avec
des données connues confronte le résultat à ce qu'on attend.

Le moteur réel compte ici. Tester contre un SQLite en mémoire ne dirait rien d'une procédure T-SQL,
dont la syntaxe et le comportement sont propres à SQL Server. Un conteneur SQL Server jetable, monté
le temps du test avec [Testcontainers](https://dotnet.testcontainers.org/), exécute les vraies
migrations sur le vrai moteur, et la procédure est éprouvée dans les conditions de la production.

Ce filet est le pendant du forward-only. Sans rollback automatique, une procédure fautive se corrige
en avant, et le meilleur moment pour l'attraper reste avant qu'elle ne parte, sur ce moteur jetable
plutôt que sur la base live.

## Où l'externalisation se justifie

Le motif suppose des procédures et des vues. Une application dont l'accès aux données passe
entièrement par le modèle et LINQ n'en a aucune, et n'a rien à externaliser : le CRUD sur tables est
déjà couvert par les migrations classiques.

Il devient utile quand le SQL procédural existe et se multiplie : des vues de reporting, des
procédures pour des opérations en masse ou une logique que l'on garde délibérément près des données.
À partir de quelques objets qui évoluent, les fichiers versionnés remboursent leur mise en place. Le
SQL redevient lisible, relu et outillé, et les migrations restent l'unique voie de déploiement.

En deçà, pour une ou deux procédures stables qui ne changent jamais, une chaîne dans une migration
fait l'affaire. Le motif organise une complexité réelle, et il n'a pas à être payé quand elle n'est
pas là.

> Les migrations EF Core modélisent les tables et transportent mal le reste. Garder procédures et
> vues comme fichiers `.sql` versionnés, appliqués en `CREATE OR ALTER` par de petites extensions de
> `MigrationBuilder`, rend ce SQL diffable et relu tout en laissant les migrations comme seule voie de
> déploiement. Le prix est une discipline forward-only, assumée dans un `Down()` vide.
