La reflexión tiene un coste que se paga en el peor momento: al arrancar y en caliente, en el
código de producción. Los **source generators** desplazan ese trabajo al otro extremo del ciclo,
a la **compilación**. El generador lee tu código, produce otro, y el compilador lo incluye
en el ensamblado como si lo hubieras escrito a mano.

## Incremental, no la antigua API

La primera ola de generadores (`ISourceGenerator`) recalculaba todo con cada pulsación de tecla
y arruinaba la experiencia en el IDE.

La API correcta hoy es **`IIncrementalGenerator`**: construye un pipeline con caché, donde solo
se recalculan las entradas modificadas. Se filtra la compilación en dos fases, con un predicado
**sintáctico** rápido primero, y después una transformación **semántica** más costosa.

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

El `static` en las lambdas garantiza que ninguna captura rompa la caché del pipeline.

## Un caso concreto: registrar la DI

El escenario clásico: marcar una clase con un atributo `[RegisterScoped]`, y dejar que el
generador produzca la llamada `AddScoped` correspondiente. El `Program.cs` deja de alargarse con
cada servicio, y el escaneo de ensamblados por reflexión al arrancar desaparece.

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

El `Program.cs` se limita entonces a un `builder.Services.AddGenerated();`. El código es
**visible**, depurable, y el compilador lo valida como al resto.

## Reportar diagnósticos

Un buen generador también guía al autor. En lugar de producir C# inválido cuando el atributo
está mal colocado, se reporta un **diagnóstico** que el IDE muestra como un warning o un error
nativo, exactamente en el lugar correcto del archivo fuente.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type non instanciable",
    messageFormat: "'{0}' es abstracto o estático y no se puede registrar",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

Este diagnóstico se emite mediante `context.ReportDiagnostic(...)` en cuanto se detecta el caso,
y el error aparece **en el editor**, subrayado bajo el tipo problemático, sin llegar nunca a la
ejecución.

## Build-time contra reflexión

El interés va mucho más allá del rendimiento. Un error (un servicio olvidado, un tipo no
resuelto) surge **en la compilación**, no en la primera petición en producción.

El código generado está a la vista: activa `EmitCompilerGeneratedFiles` para inspeccionarlo. Es
trimmable y compatible con **AOT/Native**, allí donde la reflexión hace tropezar al enlazador.

Es exactamente la dirección que ha tomado el ecosistema: `System.Text.Json`, el logging y las
opciones de ASP.NET migran hacia generadores. El tutorial oficial detalla el pipeline en la
[doc Roslyn source generators](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview).

> Un source generator produce el código que habrías escrito a mano, pero es el
> compilador quien lo escribe y quien lo verifica: la metaprogramación ocurre en la
> compilación, sin magia en tiempo de ejecución.
