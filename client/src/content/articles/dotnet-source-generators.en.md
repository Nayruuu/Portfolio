Reflection has a cost you pay at the worst moment: at startup and on the hot path, in
production code. **Source generators** move that work to the other end of the cycle — to
**compile time**. The generator reads your code, produces more of it, and the compiler folds
it into the assembly as if you'd written it by hand.

## Incremental, not the old API

The first wave of generators (`ISourceGenerator`) re-ran everything on every keystroke and
wrecked the IDE experience. The right API today is **`IIncrementalGenerator`**: it builds a
cached pipeline where only changed inputs are recomputed. You filter the compilation in two
stages — a fast **syntactic** predicate, then a costlier **semantic** transform.

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

The `static` on the lambdas isn't cosmetic: it guarantees no capture breaks the pipeline's
caching.

## A concrete case: wiring up DI

The classic scenario: mark a class with a `[RegisterScoped]` attribute, and let the generator
produce the matching `AddScoped` call. No more `Program.cs` growing with every service, no
more reflection-based assembly scan at startup.

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

`Program.cs` then just calls `builder.Services.AddGenerated();`. The code is **visible**,
debuggable, and the compiler validates it like everything else.

## Diagnostics: warn, don't crash

A good generator doesn't just emit code: it **guides** the author. Rather than producing
invalid C# when the attribute is misused, you raise a **diagnostic** that the IDE surfaces as a
native warning or error, right at the offending spot in the source file.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type is not instantiable",
    messageFormat: "'{0}' is abstract or static and cannot be registered in DI",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

You emit this diagnostic via `context.ReportDiagnostic(...)` the moment you detect the case,
and the error shows up **in the editor**, squiggled under the offending type — without ever
reaching runtime.

## Build-time versus reflection

The benefit goes well beyond performance. A mistake — a forgotten service, an unresolved type
— surfaces **at compile time**, not on the first request in production. The generated code is
right there in front of you (enable `EmitCompilerGeneratedFiles` to inspect it), trimmable and
**AOT/Native**-friendly — exactly where reflection trips up the linker. This is the direction
the ecosystem is taking: `System.Text.Json`, logging and ASP.NET options are all migrating to
generators. The official tutorial walks through the pipeline in the
[Roslyn source generators docs](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview).

> A source generator is **honest** metaprogramming: no runtime magic, just code you'd have
> written by hand — except the compiler writes it for you, and checks it on the way.
