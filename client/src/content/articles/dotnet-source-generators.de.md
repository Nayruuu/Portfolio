Reflection hat einen Preis, den man im ungünstigsten Moment bezahlt: beim Start und im
laufenden Betrieb, im Produktionscode. **Source Generators** verlagern diese Arbeit ans andere
Ende des Zyklus, zur **Kompilierzeit**. Der Generator liest Ihren Code, erzeugt daraus neuen,
und der Compiler nimmt ihn in die Assembly auf, als hätten Sie ihn von Hand geschrieben.

## Incremental, nicht die alte API

Die erste Welle von Generatoren (`ISourceGenerator`) lief bei jedem Tastendruck komplett neu
durch und ruinierte das Arbeiten in der IDE.

Die richtige API ist heute **`IIncrementalGenerator`**: Sie baut eine gecachte Pipeline auf, in
der nur geänderte Eingaben neu berechnet werden. Die Kompilierung wird in zwei Schritten
gefiltert, zuerst mit einem schnellen **syntaktischen** Prädikat, dann mit einer teureren
**semantischen** Transformation.

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

Das `static` auf den Lambdas garantiert, dass kein Capture das Caching der Pipeline aushebelt.

## Ein konkreter Fall: DI-Registrierung

Das klassische Szenario: eine Klasse mit dem Attribut `[RegisterScoped]` markieren und den
Generator den passenden `AddScoped`-Aufruf erzeugen lassen. Die `Program.cs` wächst nicht mehr
mit jedem Service, und der Assembly-Scan per Reflection beim Start entfällt.

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

Die `Program.cs` beschränkt sich dann auf ein `builder.Services.AddGenerated();`. Der Code ist
**sichtbar**, lässt sich debuggen, und der Compiler validiert ihn wie den Rest.

## Diagnosen zurückmelden

Ein guter Generator leitet auch den Autor an. Statt ungültiges C# zu erzeugen, wenn das
Attribut falsch gesetzt ist, meldet man eine **Diagnose** zurück, die die IDE wie eine native
Warnung oder einen nativen Fehler anzeigt, genau an der richtigen Stelle der Quelldatei.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type non instanciable",
    messageFormat: "'{0}' ist abstrakt oder statisch und kann nicht registriert werden",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

Diese Diagnose wird über `context.ReportDiagnostic(...)` ausgegeben, sobald der Fall erkannt
wird, und der Fehler erscheint **im Editor**, unterstrichen unter dem fehlerhaften Typ, ohne je
die Ausführung zu erreichen.

## Build-Time gegen Reflection

Der Nutzen geht weit über die Performance hinaus. Ein Fehler (ein vergessener Service, ein
nicht aufgelöster Typ) taucht **beim Kompilieren** auf, nicht bei der ersten Anfrage in der
Produktion.

Der generierte Code liegt vor Ihren Augen: Aktivieren Sie `EmitCompilerGeneratedFiles`, um ihn
zu inspizieren. Er ist trimmbar und **AOT/Native**-kompatibel, dort wo Reflection den Linker
stolpern lässt.

Genau diese Richtung schlägt das Ökosystem ein: `System.Text.Json`, das Logging und die
ASP.NET-Optionen wandern zu Generatoren. Das offizielle Tutorial beschreibt die Pipeline in der
[Roslyn-Doku zu Source Generators](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview).

> Ein Source Generator erzeugt den Code, den Sie von Hand geschrieben hätten, nur schreibt ihn
> der Compiler und prüft ihn dabei: Die Metaprogrammierung findet beim Kompilieren statt, ohne
> Magie zur Laufzeit.
