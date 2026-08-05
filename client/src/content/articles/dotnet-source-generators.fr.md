La réflexion coûte au pire moment : au démarrage et à chaud, dans le code qui tourne en
production. Un scan d'assembly au boot, un `Activator.CreateInstance` résolu à la volée, tout ça
se paie au runtime. Les **source generators** déplacent ce travail à l'autre bout du cycle, à la
**compilation**. Le générateur lit votre code, en produit d'autre, et le compilateur intègre le
résultat dans l'assembly comme si vous l'aviez tapé à la main.

## Incremental, pas l'ancienne API

La première génération d'API, `ISourceGenerator`, avait un défaut structurel : elle
re-exécutait tout le générateur à chaque frappe. Sur un gros projet, chaque caractère tapé
relançait l'analyse complète, et l'éditeur ralentissait à mesure que le code grossissait.

`IIncrementalGenerator` change le modèle. Au lieu d'une fonction qui produit du code, on décrit
un **pipeline** de transformations. Roslyn met en cache la sortie de chaque étape et compare, à
la frappe suivante, l'entrée d'une étape avec sa valeur précédente. Si elle est identique,
l'étape n'est pas rejouée : sa sortie déjà calculée est réutilisée. Un commentaire ajouté dans
une méthode ne touche pas le modèle sémantique que lit votre générateur, le pipeline s'arrête
tôt, et rien n'est régénéré.

Tout le travail consiste donc à découper le traitement en étapes dont les entrées changent
rarement, et à faire circuler entre elles des données comparables par valeur.

## Le pipeline en deux temps

Un pipeline attribut-orienté commence par filtrer les millions de nœuds syntaxiques de la
compilation. Le prédicat passe en premier : il doit être **syntaxique** et rapide, car il tourne
sur chaque nœud. Il ne teste qu'une chose, sans modèle sémantique : la forme du nœud. La
transformation vient ensuite, seulement sur les nœuds retenus, et là on a le droit d'être
**sémantique**, de résoudre des symboles et de lire des attributs.

Depuis Roslyn 4.3, `ForAttributeWithMetadataName` court-circuite tout ce filtrage pour le cas le
plus courant, la détection d'un attribut marqueur. Le compilateur maintient un index des
attributs et ne présente au générateur que les nœuds réellement décorés, ce qui évite de
parcourir l'arbre entier. C'est l'entrée à privilégier ; `CreateSyntaxProvider` reste là pour
les cas qui ne reposent pas sur un attribut.

```csharp
[Generator]
public sealed class ServiceRegistrationGenerator : IIncrementalGenerator
{
    private const string Marker = "MyApp.RegisterScopedAttribute";

    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        // Emit the marker attribute itself, before anything reads the syntax trees.
        context.RegisterPostInitializationOutput(static ctx => ctx.AddSource(
            "RegisterScopedAttribute.g.cs",
            """
            namespace MyApp;

            [System.AttributeUsage(System.AttributeTargets.Class)]
            internal sealed class RegisterScopedAttribute : System.Attribute;
            """));

        IncrementalValuesProvider<ServiceModel> services = context.SyntaxProvider
            .ForAttributeWithMetadataName(
                Marker,
                predicate: static (node, _) => node is ClassDeclarationSyntax,
                transform: static (ctx, _) => new ServiceModel(ctx.TargetSymbol.ToDisplayString()));

        context.RegisterSourceOutput(services.Collect(), Emit);
    }
}
```

Le `static` sur chaque lambda est délibéré. Une lambda qui capture une variable transporte cet
état dans le pipeline et peut y introduire une référence non comparable, ce qui fait manquer le
cache. `RegisterPostInitializationOutput` sert à émettre l'attribut lui-même : il devient
disponible pour le reste de la compilation sans que le consommateur ait à référencer un package
séparé.

## Ce qui casse le cache

Le cache repose entièrement sur l'égalité. Roslyn compare l'entrée d'une étape avec la
précédente via `EqualityComparer<T>.Default`. Si le type ne définit pas une égalité de valeur
correcte, chaque frappe ressemble à un changement, le pipeline se rejoue en entier, et tout le
bénéfice de l'incrémental disparaît.

Deux pièges dominent. Le premier consiste à faire transiter un `ISymbol`, un `SyntaxNode`, une
`SemanticModel` ou une `Compilation` d'une étape à l'autre. Ces objets n'ont pas d'égalité de
valeur, et surtout ils maintiennent en vie toute la compilation dont ils sont issus. La
transformation doit en extraire aussitôt ce dont elle a besoin, dans un petit modèle plat.

```csharp
// A flat, value-equatable snapshot: no ISymbol, no SyntaxNode, no Compilation.
// Holding any of those pins the whole compilation and defeats the cache.
internal readonly record struct ServiceModel(string FullyQualifiedName);
```

Le second piège est plus discret. `ImmutableArray<T>` compare son tableau sous-jacent par
référence, pas élément par élément : un modèle qui expose un `ImmutableArray<T>` en champ
paraîtra modifié à chaque passe, même à contenu identique. La parade habituelle est un petit
wrapper qui compare par `SequenceEqual`, souvent nommé `EquatableArray<T>`, que la plupart des
générateurs sérieux embarquent.

Même prudence avec `context.CompilationProvider` : la `Compilation` change à chaque frappe. Le
combiner directement à votre pipeline le fait tout recalculer. Si une seule information de la
compilation vous est utile, réduisez-la d'abord avec `Select` vers une petite valeur comparable
avant de la combiner.

## Un cas concret : enregistrer la DI

Le scénario le plus rentable : marquer une classe d'un `[RegisterScoped]`, laisser le générateur
produire l'appel `AddScoped` correspondant, et collecter le tout dans une méthode d'extension.
`Program.cs` cesse de s'allonger à chaque service ajouté, et le scan d'assembly par réflexion au
démarrage disparaît.

```csharp
private static void Emit(SourceProductionContext context, ImmutableArray<ServiceModel> services)
{
    if (services.IsDefaultOrEmpty)
        return;

    var registrations = string.Join(
        "\n        ",
        services.Select(s => $"services.AddScoped<{s.FullyQualifiedName}>();"));

    context.AddSource("ServiceRegistrations.g.cs", $$"""
        namespace MyApp;

        public static class GeneratedServices
        {
            public static IServiceCollection AddGenerated(this IServiceCollection services)
            {
                {{registrations}}
                return services;
            }
        }
        """);
}
```

`Program.cs` se réduit alors à `builder.Services.AddGenerated();`. Le code produit est visible,
débogable, et le compilateur le valide comme le vôtre. Activez `<EmitCompilerGeneratedFiles>`
dans le `.csproj` pour retrouver les fichiers `.g.cs` sur le disque et les relire.

## Remonter des diagnostics

Un générateur ne fait pas que produire du code : il peut refuser d'en produire, et le dire.
Plutôt que d'émettre du C# invalide quand l'attribut est mal posé, sur un type abstrait par
exemple, on remonte un **diagnostic**.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type non instanciable",
    messageFormat: "'{0}' est abstrait ou statique et ne peut pas être enregistré en DI",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

On l'émet via `context.ReportDiagnostic(Diagnostic.Create(MustBeConcrete, location, typeName))`
dès qu'on repère le cas. L'erreur apparaît dans l'éditeur, soulignée sous le type fautif, à la
même place qu'une erreur du compilateur, et n'atteint jamais l'exécution.

## Build-time contre réflexion

L'enregistrement de DI n'est qu'un exemple. La génération de mappers entre DTO et entités, les
helpers d'enum (parsing sans boxing, un `ToStringFast` sans allocation), la sérialisation :
partout où l'on écrivait de la réflexion ou du code répétitif à la main, un générateur produit le
même résultat à la compilation, une fois, et de façon lisible.

L'écosystème a pris cette direction. `System.Text.Json` génère ses convertisseurs via un
générateur de source, et le logging à haute performance d'ASP.NET s'écrit avec `[LoggerMessage]`.
La raison de fond dépasse la vitesse : le code généré est **trimmable** et compatible
**AOT/Native**, là où la réflexion fait trébucher l'éditeur de liens. Et une erreur (un service
oublié, un type non résolu) surgit à la compilation, pas à la première requête en production.

Le tutoriel officiel couvre toute la surface d'API dans la
[doc Roslyn](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview),
et le [document de conception des générateurs incrémentaux](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.md)
détaille le modèle de cache.

> Un source generator produit le code que vous auriez écrit à la main, mais c'est le compilateur
> qui l'écrit et qui le vérifie. La métaprogrammation se joue à la compilation, et l'essentiel du
> métier est de garder le pipeline comparable par valeur pour que son cache tienne d'une frappe à
> l'autre.
