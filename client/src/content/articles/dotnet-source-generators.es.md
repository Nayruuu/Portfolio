La reflexión tiene un coste que se paga en el peor momento: en el arranque y en la ruta caliente, en el código de producción. Los **source generators** trasladan ese trabajo al otro extremo del ciclo — a la **compilación**. El generador lee tu código, produce más código, y el compilador lo incluye en el assembly como si lo hubieras escrito a mano.

## Incremental, no la API antigua

La primera oleada de generadores (`ISourceGenerator`) recalculaba todo en cada pulsación y arruinaba la experiencia en el IDE. La API correcta hoy es **`IIncrementalGenerator`**: construye un pipeline en caché, donde solo se recalculan las entradas modificadas. Filtramos la compilación en dos tiempos — un predicado **sintáctico** rápido, luego una transformación **semántica** más costosa.

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

El `static` en las lambdas no es cosmético: garantiza que ninguna captura rompa el caché del pipeline.

## Un caso concreto: registrar la DI

El escenario clásico: marcar una clase con el atributo `[RegisterScoped]` y dejar que el generador produzca la llamada `AddScoped` correspondiente. Sin más `Program.cs` que se alarga con cada servicio, sin más escaneo de assembly por reflexión en el arranque.

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

El `Program.cs` se limita entonces a un `builder.Services.AddGenerated();`. El código es **visible**, depurable, y el compilador lo valida como el resto.

## Diagnósticos: prevenir, no fallar

Un buen generador no se limita a emitir código: **guía** al autor. En lugar de producir C# inválido cuando el atributo está mal colocado, se emite un **diagnóstico** que el IDE muestra como un warning o un error nativo, exactamente en el lugar correcto del archivo fuente.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type non instanciable",
    messageFormat: "'{0}' est abstrait ou statique et ne peut pas être enregistré en DI",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

Se emite este diagnóstico mediante `context.ReportDiagnostic(...)` en cuanto se detecta el caso, y el error aparece **en el editor**, subrayado bajo el tipo defectuoso — sin llegar nunca a la ejecución.

## Build-time frente a reflexión

El beneficio va mucho más allá del rendimiento. Un error — un servicio olvidado, un tipo no resuelto — surge **en la compilación**, no en la primera petición en producción. El código generado está a la vista (activa `EmitCompilerGeneratedFiles` para inspeccionarlo), trimmable y compatible con **AOT/Native** — donde la reflexión hace tropezar al enlazador. Es exactamente la dirección que toma el ecosistema: `System.Text.Json`, el logging y las opciones de ASP.NET migran hacia generadores. El tutorial oficial detalla el pipeline en la [doc Roslyn source generators](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview).

> Un source generator es metaprogramación **honesta**: sin magia en tiempo de ejecución, solo código que habrías escrito a mano — pero que el compilador escribe por ti, y valida de paso.
