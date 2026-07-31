Reflection has a cost that gets paid at the worst possible moment: at startup and at runtime,
in production code. **Source generators** move that work to the other end of the cycle, to **compile time**.
The generator reads your code, produces more of it, and the compiler includes it in the
assembly as if you had written it by hand.

## Incremental, not the old API

The first wave of generators (`ISourceGenerator`) re-ran everything on every keystroke and
ruined the IDE experience.

The right API today is **`IIncrementalGenerator`**: it builds a cached pipeline, where only
the changed inputs are recomputed. The compilation is filtered in two steps, with a fast
**syntactic** predicate first, then a costlier **semantic** transformation.

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

The `static` on the lambdas guarantees that no capture breaks the pipeline's caching.

## A concrete case: registering DI

The classic scenario: mark a class with a `[RegisterScoped]` attribute, and let the generator
produce the corresponding `AddScoped` call. `Program.cs` stops growing with every service, and
the reflection-based assembly scan at startup disappears.

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

`Program.cs` then just needs a `builder.Services.AddGenerated();`. The code is **visible**,
debuggable, and validated by the compiler like everything else.

## Surfacing diagnostics

A good generator also guides the author. Rather than producing invalid C# when the attribute
is misused, it surfaces a **diagnostic** that the IDE displays like a native warning or error,
right at the correct spot in the source file.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type non instanciable",
    messageFormat: "'{0}' is abstract or static and cannot be registered",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

This diagnostic is emitted via `context.ReportDiagnostic(...)` as soon as the case is
detected, and the error appears **right in the editor**, underlined beneath the offending
type, without ever reaching runtime.

## Build-time versus reflection

The benefit goes well beyond performance. An error (a forgotten service, an unresolved type)
surfaces **at compile time**, not on the first request in production.

The generated code is right there in front of you: enable `EmitCompilerGeneratedFiles` to
inspect it. It is trimmable and **AOT/Native**-compatible, whereas reflection trips up the
linker.

This is exactly the direction the ecosystem is taking: `System.Text.Json`, logging, and ASP.NET
options are migrating to generators. The official tutorial details the pipeline in the
[Roslyn source generators doc](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview).

> A source generator produces the code you would have written by hand, but the compiler is
> the one writing it and checking it: metaprogramming happens at compile time, with no magic
> at runtime.
