## Inkrementell, nicht die alte API

Die erste Generation von Generatoren (`ISourceGenerator`) lief bei jedem Tastendruck vollständig durch und ruinierte die IDE-Erfahrung. Die richtige API heute ist **`IIncrementalGenerator`**: Sie baut eine gecachte Pipeline auf, in der nur geänderte Eingaben neu berechnet werden. Die Kompilierung wird in zwei Schritten gefiltert — ein schnelles **syntaktisches** Prädikat, dann eine aufwändigere **semantische** Transformation.

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

Das `static` auf den Lambdas ist kein Stilmittel: Es stellt sicher, dass keine Capture das Pipeline-Caching unterbricht.

## Ein konkretes Beispiel: DI-Registrierung

Das klassische Szenario: Eine Klasse mit einem `[RegisterScoped]`-Attribut markieren und den Generator den entsprechenden `AddScoped`-Aufruf erzeugen lassen. Kein `Program.cs`, das mit jedem Service länger wird, kein Assembly-Scan per Reflexion beim Start.

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

`Program.cs` beschränkt sich dann auf ein `builder.Services.AddGenerated();`. Der Code ist **sichtbar**, debuggbar, und der Compiler validiert ihn wie alles andere.

## Diagnostics: Warnen, nicht abstürzen

Ein guter Generator beschränkt sich nicht darauf, Code auszugeben: Er **leitet** den Autor an. Anstatt ungültiges C# zu erzeugen, wenn das Attribut falsch platziert ist, wird ein **Diagnostic** ausgegeben, das die IDE als nativen Warning oder Fehler genau an der richtigen Stelle in der Quelldatei anzeigt.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type non instanciable",
    messageFormat: "'{0}' est abstrait ou statique et ne peut pas être enregistré en DI",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

Dieses Diagnostic wird über `context.ReportDiagnostic(...)` ausgegeben, sobald der Fall erkannt wird, und der Fehler erscheint **im Editor**, unterstrichen unter dem fehlerhaften Typ — ohne jemals die Ausführung zu erreichen.

## Build-Zeit gegen Reflexion

Der Vorteil geht weit über Performance hinaus. Ein Fehler — ein vergessener Service, ein nicht aufgelöster Typ — taucht **zur Kompilierung** auf, nicht bei der ersten Anfrage in der Produktion. Der generierte Code liegt vor Ihren Augen (aktivieren Sie `EmitCompilerGeneratedFiles`, um ihn zu inspizieren), ist trimmbar und **AOT/Native**-kompatibel — genau dort, wo Reflexion den Linker stolpern lässt. Das ist exakt die Richtung, die das Ökosystem einschlägt: `System.Text.Json`, Logging und ASP.NET-Optionen migrieren zu Generatoren. Das offizielle Tutorial beschreibt die Pipeline in der [doc Roslyn source generators](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview).

> Ein Source Generator ist **ehrliche** Metaprogrammierung: keine Magie zur Laufzeit, nur Code, den Sie von Hand geschrieben hätten — aber den der Compiler für Sie schreibt und dabei gleich überprüft.
