La réflexion a un coût qu'on paie au pire moment : au démarrage et à chaud, dans le code de
production. Les **source generators** déplacent ce travail à l'autre bout du cycle — à la
**compilation**. Le générateur lit votre code, en produit d'autre, et le compilateur l'inclut
dans l'assembly comme si vous l'aviez écrit à la main.

## Incremental, pas l'ancienne API

La première vague de générateurs (`ISourceGenerator`) re-tournait tout à chaque frappe et
ruinait l'expérience dans l'IDE. La bonne API aujourd'hui est **`IIncrementalGenerator`** :
elle construit un pipeline mis en cache, où seules les entrées modifiées sont recalculées. On
filtre la compilation en deux temps — un prédicat **syntaxique** rapide, puis une transformation
**sémantique** plus coûteuse.

```csharp
[Generator]
public sealed class ServiceRegistrationGenerator : IIncrementalGenerator
{
    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        var services = context.SyntaxProvider.ForAttributeWithMetadataName(
            "MyApp.RegisterScopedAttribute",
            predicate: static (node, _) => node is ClassDeclarationSyntax,
            transform: static (ctx, _) => ctx.TargetSymbol.ToDisplayString());

        context.RegisterSourceOutput(services.Collect(), Emit);
    }
}
```

Le `static` sur les lambdas n'est pas cosmétique : il garantit qu'aucune capture ne casse la
mise en cache du pipeline.

## Un cas concret : enregistrer la DI

Le scénario classique : marquer une classe d'un attribut `[RegisterScoped]`, et laisser le
générateur produire l'appel `AddScoped` correspondant. Plus de `Program.cs` qui s'allonge à
chaque service, plus de scan d'assembly par réflexion au démarrage.

```csharp
private static void Emit(SourceProductionContext context, ImmutableArray<string> types)
{
    var registrations = string.Join(
        "\n        ",
        types.Select(type => $"services.AddScoped<{type}>();"));

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

Le `Program.cs` se contente alors d'un `builder.Services.AddGenerated();`. Le code est
**visible**, débogable, et le compilateur le valide comme le reste.

## Diagnostics : prévenir, pas planter

Un bon générateur ne se contente pas d'émettre du code : il **guide** l'auteur. Plutôt que de
produire du C# invalide quand l'attribut est mal posé, on remonte un **diagnostic** que l'IDE
affiche comme un warning ou une erreur native, exactement au bon endroit du fichier source.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type non instanciable",
    messageFormat: "'{0}' est abstrait ou statique et ne peut pas être enregistré en DI",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

On émet ce diagnostic via `context.ReportDiagnostic(...)` dès qu'on détecte le cas, et l'erreur
apparaît **dans l'éditeur**, soulignée sous le type fautif — sans jamais atteindre l'exécution.

## Build-time contre réflexion

L'intérêt va bien au-delà de la performance. Une erreur — un service oublié, un type non
résolu — surgit **à la compilation**, pas à la première requête en production. Le code généré
est sous vos yeux (activez `EmitCompilerGeneratedFiles` pour l'inspecter), trimmable et
compatible **AOT/Native** — là où la réflexion fait trébucher l'éditeur de liens. C'est
exactement la direction prise par l'écosystème : `System.Text.Json`, le logging et les options
ASP.NET migrent vers des générateurs. Le tutoriel officiel détaille le pipeline dans la
[doc Roslyn source generators](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview).

> Un source generator, c'est de la métaprogrammation **honnête** : pas de magie au runtime,
> juste du code que vous auriez écrit à la main — mais que le compilateur écrit pour vous, et
> vérifie au passage.
