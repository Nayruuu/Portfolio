That tool call wasn't needed for this task — apologies, proceeding directly with the translation.

Die Reflexion kostet im schlimmsten Moment: beim Start und im laufenden Betrieb, im Code, der in
Produktion läuft. Ein Assembly-Scan beim Boot, ein zur Laufzeit aufgelöstes
`Activator.CreateInstance`, all das bezahlt man zur Laufzeit. Die **Source Generators**
verschieben diese Arbeit ans andere Ende des Zyklus, zur **Kompilierung**. Der Generator liest
Ihren Code, erzeugt weiteren, und der Compiler integriert das Ergebnis in das Assembly, als
hätten Sie es von Hand getippt.

## Incremental, nicht die alte API

Die erste API-Generation, `ISourceGenerator`, hatte einen strukturellen Defekt: Sie führte den
gesamten Generator bei jedem Tastenanschlag erneut aus. Bei einem großen Projekt löste jedes
getippte Zeichen die vollständige Analyse aus, und der Editor wurde mit wachsendem Code
langsamer.

`IIncrementalGenerator` ändert das Modell. Statt einer Funktion, die Code produziert,
beschreibt man eine **Pipeline** von Transformationen. Roslyn cacht die Ausgabe jedes Schritts
und vergleicht beim nächsten Tastenanschlag die Eingabe eines Schritts mit ihrem vorherigen
Wert. Ist sie identisch, wird der Schritt nicht erneut ausgeführt: seine bereits berechnete
Ausgabe wird wiederverwendet. Ein in eine Methode eingefügter Kommentar berührt nicht das
semantische Modell, das Ihr Generator liest, die Pipeline stoppt früh, und nichts wird neu
generiert.

Die ganze Arbeit besteht also darin, die Verarbeitung in Schritte zu zerlegen, deren Eingaben
sich selten ändern, und zwischen ihnen Daten zirkulieren zu lassen, die nach Wert vergleichbar
sind.

## Die Pipeline in zwei Schritten

Eine attributorientierte Pipeline beginnt damit, die Millionen syntaktischer Knoten der
Kompilierung zu filtern. Das Prädikat kommt zuerst: Es muss **syntaktisch** und schnell sein,
denn es läuft auf jedem Knoten. Es prüft nur eines, ohne semantisches Modell: die Form des
Knotens. Die Transformation kommt anschließend, nur auf den behaltenen Knoten, und dort darf man
**semantisch** sein, Symbole auflösen und Attribute lesen.

Seit Roslyn 4.3 überspringt `ForAttributeWithMetadataName` diese ganze Filterung für den
häufigsten Fall, die Erkennung eines Marker-Attributs. Der Compiler pflegt einen Index der
Attribute und präsentiert dem Generator nur die tatsächlich dekorierten Knoten, was das
Durchlaufen des gesamten Baums vermeidet. Das ist der zu bevorzugende Einstiegspunkt;
`CreateSyntaxProvider` bleibt für die Fälle, die nicht auf einem Attribut beruhen.

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

Das `static` bei jeder Lambda ist bewusst gesetzt. Eine Lambda, die eine Variable erfasst,
transportiert diesen Zustand in der Pipeline und kann darin eine nicht vergleichbare Referenz
einführen, was das Caching verfehlen lässt. `RegisterPostInitializationOutput` dient dazu, das
Attribut selbst zu emittieren: Es steht dem Rest der Kompilierung zur Verfügung, ohne dass der
Konsument ein separates Paket referenzieren muss.

## Was den Cache bricht

Der Cache beruht vollständig auf Gleichheit. Roslyn vergleicht die Eingabe eines Schritts mit
der vorherigen über `EqualityComparer<T>.Default`. Definiert der Typ keine korrekte
Wertgleichheit, sieht jeder Tastenanschlag wie eine Änderung aus, die Pipeline wird komplett neu
ausgeführt, und der gesamte Nutzen des Incremental-Modells verschwindet.

Zwei Fallstricke überwiegen. Der erste besteht darin, ein `ISymbol`, einen `SyntaxNode`, ein
`SemanticModel` oder eine `Compilation` von einem Schritt zum nächsten zu transportieren. Diese
Objekte haben keine Wertgleichheit, und vor allem halten sie die gesamte Kompilierung, aus der
sie stammen, am Leben. Die Transformation muss daraus sofort das extrahieren, was sie braucht,
in ein kleines flaches Modell.

```csharp
// A flat, value-equatable snapshot: no ISymbol, no SyntaxNode, no Compilation.
// Holding any of those pins the whole compilation and defeats the cache.
internal readonly record struct ServiceModel(string FullyQualifiedName);
```

Der zweite Fallstrick ist diskreter. `ImmutableArray<T>` vergleicht sein zugrunde liegendes
Array nach Referenz, nicht Element für Element: Ein Modell, das ein `ImmutableArray<T>` als Feld
freigibt, wirkt bei jedem Durchlauf verändert, selbst bei identischem Inhalt. Die übliche
Abhilfe ist ein kleiner Wrapper, der per `SequenceEqual` vergleicht, oft `EquatableArray<T>`
genannt, den die meisten ernsthaften Generatoren mitbringen.

Dieselbe Vorsicht gilt für `context.CompilationProvider`: Die `Compilation` ändert sich bei
jedem Tastenanschlag. Sie direkt mit Ihrer Pipeline zu kombinieren, lässt alles neu berechnen.
Ist nur eine einzelne Information aus der Kompilierung für Sie nützlich, reduzieren Sie sie
zunächst mit `Select` auf einen kleinen vergleichbaren Wert, bevor Sie sie kombinieren.

## Ein konkreter Fall: die DI registrieren

Das lohnendste Szenario: eine Klasse mit `[RegisterScoped]` markieren, den Generator den
entsprechenden `AddScoped`-Aufruf erzeugen lassen und alles in einer Extension-Methode sammeln.
`Program.cs` wächst nicht mehr mit jedem hinzugefügten Service, und der Assembly-Scan per
Reflexion beim Start verschwindet.

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

`Program.cs` reduziert sich dann auf `builder.Services.AddGenerated();`. Der erzeugte Code ist
sichtbar, debuggbar, und der Compiler validiert ihn wie Ihren eigenen. Aktivieren Sie
`<EmitCompilerGeneratedFiles>` in der `.csproj`, um die `.g.cs`-Dateien auf der Festplatte
wiederzufinden und erneut zu lesen.

## Diagnosen zurückmelden

Ein Generator produziert nicht nur Code: Er kann die Produktion verweigern und es mitteilen.
Statt ungültiges C# zu emittieren, wenn das Attribut falsch gesetzt ist, etwa an einem
abstrakten Typ, meldet man eine **Diagnose**.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type non instanciable",
    messageFormat: "'{0}' est abstrait ou statique et ne peut pas être enregistré en DI",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

Man emittiert sie über `context.ReportDiagnostic(Diagnostic.Create(MustBeConcrete, location, typeName))`,
sobald man den Fall erkennt. Der Fehler erscheint im Editor, unterstrichen unter dem
fehlerhaften Typ, an derselben Stelle wie ein Compiler-Fehler, und erreicht nie die Ausführung.

## Build-Time gegen Reflexion

Die DI-Registrierung ist nur ein Beispiel. Die Generierung von Mappern zwischen DTOs und
Entitäten, Enum-Helfer (Parsing ohne Boxing, ein `ToStringFast` ohne Allokation), die
Serialisierung: überall dort, wo man von Hand Reflexion oder repetitiven Code schrieb, erzeugt
ein Generator dasselbe Ergebnis bei der Kompilierung, einmal, und in lesbarer Form.

Das Ökosystem hat diese Richtung eingeschlagen. `System.Text.Json` generiert seine Converter
über einen Source Generator, und das High-Performance-Logging von ASP.NET wird mit
`[LoggerMessage]` geschrieben. Der tiefere Grund geht über die Geschwindigkeit hinaus: Der
generierte Code ist **trimmbar** und **AOT/Native**-kompatibel, wo Reflexion den Linker stolpern
lässt. Und ein Fehler (ein vergessener Service, ein nicht auflösbarer Typ) taucht bei der
Kompilierung auf, nicht bei der ersten Anfrage in Produktion.

Das offizielle Tutorial deckt die gesamte API-Oberfläche in der
[Roslyn-Dokumentation](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview)
ab, und das [Design-Dokument der Incremental Generators](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.md)
beschreibt das Cache-Modell im Detail.

> Ein Source Generator produziert den Code, den Sie von Hand geschrieben hätten, aber es ist der
> Compiler, der ihn schreibt und prüft. Die Metaprogrammierung spielt sich bei der Kompilierung
> ab, und das Wesentliche der Aufgabe besteht darin, die Pipeline wertvergleichbar zu halten,
> damit ihr Cache von einem Tastenanschlag zum nächsten hält.
