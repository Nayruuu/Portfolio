La réflexion coûte au pire moment : au démarrage et à chaud, dans le code qui tourne en production.

Reflection costs the most at the worst possible time: at startup and while hot, in code running in production. An assembly scan at boot, an `Activator.CreateInstance` resolved on the fly, all of that gets paid at runtime. **Source generators** move that work to the other end of the cycle, to **compilation**. The generator reads your code, produces more of it, and the compiler integrates the result into the assembly as if you had typed it by hand.

## Incremental, not the old API

The first generation of the API, `ISourceGenerator`, had a structural flaw: it re-ran the entire generator on every keystroke. On a large project, every character typed would trigger a full re-analysis, and the editor would slow down as the code grew.

`IIncrementalGenerator` changes the model. Instead of a function that produces code, you describe a **pipeline** of transformations. Roslyn caches the output of each step and, on the next keystroke, compares a step's input against its previous value. If it's identical, the step isn't replayed: its already-computed output is reused. A comment added inside a method doesn't touch the semantic model your generator reads, the pipeline stops early, and nothing is regenerated.

The whole job, then, is to break the processing into steps whose inputs rarely change, and to pass data between them that's comparable by value.

## The two-stage pipeline

An attribute-oriented pipeline starts by filtering the millions of syntax nodes in the compilation. The predicate runs first: it must be **syntactic** and fast, since it runs on every node. It only tests one thing, with no semantic model: the shape of the node. The transform comes next, only on the retained nodes, and there you're allowed to be **semantic**, to resolve symbols and read attributes.

Since Roslyn 4.3, `ForAttributeWithMetadataName` short-circuits all that filtering for the most common case, detecting a marker attribute. The compiler maintains an index of attributes and only presents the generator with nodes that are actually decorated, avoiding a walk of the entire tree. It's the entry point to prefer; `CreateSyntaxProvider` remains for cases that don't rely on an attribute.

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

The `static` on each lambda is deliberate. A lambda that captures a variable carries that state into the pipeline and can introduce a non-comparable reference there, which breaks the cache. `RegisterPostInitializationOutput` is used to emit the attribute itself: it becomes available to the rest of the compilation without the consumer having to reference a separate package.

## What breaks the cache

The cache relies entirely on equality. Roslyn compares a step's input against the previous one via `EqualityComparer<T>.Default`. If the type doesn't define correct value equality, every keystroke looks like a change, the pipeline replays in full, and the whole benefit of being incremental disappears.

Two pitfalls dominate. The first is letting an `ISymbol`, a `SyntaxNode`, a `SemanticModel`, or a `Compilation` flow from one step to another. These objects don't have value equality, and above all they keep the entire compilation they came from alive. The transform must immediately extract from them whatever it needs, into a small flat model.

```csharp
// A flat, value-equatable snapshot: no ISymbol, no SyntaxNode, no Compilation.
// Holding any of those pins the whole compilation and defeats the cache.
internal readonly record struct ServiceModel(string FullyQualifiedName);
```

The second pitfall is subtler. `ImmutableArray<T>` compares its underlying array by reference, not element by element: a model that exposes an `ImmutableArray<T>` as a field will look modified on every pass, even with identical content. The usual workaround is a small wrapper that compares via `SequenceEqual`, often named `EquatableArray<T>`, which most serious generators bundle.

The same caution applies to `context.CompilationProvider`: the `Compilation` changes on every keystroke. Combining it directly into your pipeline forces everything to be recomputed. If only a single piece of information from the compilation is useful to you, reduce it first with `Select` into a small comparable value before combining it.

## A concrete case: registering DI

The most rewarding scenario: mark a class with `[RegisterScoped]`, let the generator produce the corresponding `AddScoped` call, and collect it all into an extension method. `Program.cs` stops growing with every service added, and the reflection-based assembly scan at startup disappears.

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

`Program.cs` then shrinks down to `builder.Services.AddGenerated();`. The produced code is visible, debuggable, and the compiler validates it just like yours. Enable `<EmitCompilerGeneratedFiles>` in the `.csproj` to get the `.g.cs` files back on disk and read them.

## Reporting diagnostics

A generator doesn't just produce code: it can refuse to produce it, and say so. Rather than emitting invalid C# when the attribute is misapplied, on an abstract type for example, you report back a **diagnostic**.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type non instanciable",
    messageFormat: "'{0}' est abstrait ou statique et ne peut pas être enregistré en DI",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

It's emitted via `context.ReportDiagnostic(Diagnostic.Create(MustBeConcrete, location, typeName))` as soon as the case is spotted. The error shows up in the editor, underlined beneath the offending type, in the same place as a compiler error, and never reaches execution.

## Build-time versus reflection

DI registration is just one example. Generating mappers between DTOs and entities, enum helpers (allocation-free parsing, an allocation-free `ToStringFast`), serialization: everywhere reflection or boilerplate code used to be written by hand, a generator produces the same result at compile time, once, and legibly.

The ecosystem has moved in this direction. `System.Text.Json` generates its converters via a source generator, and ASP.NET's high-performance logging is written with `[LoggerMessage]`. The underlying reason goes beyond speed: generated code is **trimmable** and compatible with **AOT/Native**, where reflection trips up the linker. And an error (a forgotten service, an unresolved type) surfaces at compile time, not on the first request in production.

The official tutorial covers the whole API surface in the
[Roslyn doc](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview),
and the [incremental generators design document](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.md)
details the caching model.

> A source generator produces the code you would have written by hand, but it's the compiler that writes it and verifies it. Metaprogramming happens at compile time, and the bulk of the craft is keeping the pipeline comparable by value so its cache holds from one keystroke to the next.
