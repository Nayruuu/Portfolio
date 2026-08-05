La réflexion se paga en el peor momento: en el arranque y en caliente, en el código que se ejecuta en
producción. Un escaneo de assembly en el boot, un `Activator.CreateInstance` resuelto al vuelo, todo eso
se paga en runtime. Los **source generators** desplazan ese trabajo al otro extremo del ciclo, a la
**compilación**. El generador lee tu código, produce otro, y el compilador integra el
resultado en el assembly como si lo hubieras escrito a mano.

## Incremental, no la API antigua

La primera generación de API, `ISourceGenerator`, tenía un defecto estructural: volvía a
ejecutar todo el generador en cada pulsación de tecla. En un proyecto grande, cada carácter escrito
relanzaba el análisis completo, y el editor se ralentizaba a medida que el código crecía.

`IIncrementalGenerator` cambia el modelo. En lugar de una función que produce código, se describe
un **pipeline** de transformaciones. Roslyn cachea la salida de cada etapa y compara, en la
siguiente pulsación, la entrada de una etapa con su valor anterior. Si es idéntica,
la etapa no se vuelve a ejecutar: se reutiliza su salida ya calculada. Un comentario añadido en
un método no toca el modelo semántico que lee tu generador, el pipeline se detiene
temprano, y no se regenera nada.

Todo el trabajo consiste, por tanto, en dividir el procesamiento en etapas cuyas entradas cambien
raramente, y en hacer circular entre ellas datos comparables por valor.

## El pipeline en dos tiempos

Un pipeline orientado a atributos empieza filtrando los millones de nodos sintácticos de la
compilación. El predicado va primero: debe ser **sintáctico** y rápido, porque se ejecuta
en cada nodo. Solo comprueba una cosa, sin modelo semántico: la forma del nodo. La
transformación viene después, solo sobre los nodos retenidos, y ahí sí se puede ser
**semántico**, resolver símbolos y leer atributos.

Desde Roslyn 4.3, `ForAttributeWithMetadataName` cortocircuita todo ese filtrado para el caso
más común, la detección de un atributo marcador. El compilador mantiene un índice de
atributos y solo presenta al generador los nodos realmente decorados, lo que evita recorrer
el árbol entero. Es la entrada a preferir; `CreateSyntaxProvider` sigue ahí para
los casos que no se basan en un atributo.

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

El `static` en cada lambda es deliberado. Una lambda que captura una variable transporta ese
estado dentro del pipeline y puede introducir ahí una referencia no comparable, lo que hace fallar el
caché. `RegisterPostInitializationOutput` sirve para emitir el propio atributo: queda
disponible para el resto de la compilación sin que el consumidor tenga que referenciar un paquete
separado.

## Lo que rompe el caché

El caché se basa enteramente en la igualdad. Roslyn compara la entrada de una etapa con la
anterior mediante `EqualityComparer<T>.Default`. Si el tipo no define una igualdad de valor
correcta, cada pulsación parece un cambio, el pipeline se vuelve a ejecutar por completo, y todo el
beneficio del incremental desaparece.

Dominan dos trampas. La primera consiste en hacer transitar un `ISymbol`, un `SyntaxNode`, una
`SemanticModel` o una `Compilation` de una etapa a otra. Esos objetos no tienen igualdad de
valor, y sobre todo mantienen viva toda la compilación de la que provienen. La
transformación debe extraer de inmediato lo que necesita, en un pequeño modelo plano.

```csharp
// A flat, value-equatable snapshot: no ISymbol, no SyntaxNode, no Compilation.
// Holding any of those pins the whole compilation and defeats the cache.
internal readonly record struct ServiceModel(string FullyQualifiedName);
```

La segunda trampa es más discreta. `ImmutableArray<T>` compara su array subyacente por
referencia, no elemento a elemento: un modelo que expone un `ImmutableArray<T>` como campo
parecerá modificado en cada pasada, incluso con contenido idéntico. El remedio habitual es un pequeño
wrapper que compara por `SequenceEqual`, a menudo llamado `EquatableArray<T>`, que la mayoría de
generadores serios incorporan.

La misma precaución con `context.CompilationProvider`: la `Compilation` cambia en cada pulsación. Combinarla
directamente con tu pipeline hace que todo se recalcule. Si solo un dato de la
compilación te resulta útil, redúcelo primero con `Select` a un pequeño valor comparable
antes de combinarlo.

## Un caso concreto: registrar la DI

El escenario más rentable: marcar una clase con `[RegisterScoped]`, dejar que el generador
produzca la llamada `AddScoped` correspondiente, y recopilar todo en un método de extensión.
`Program.cs` deja de alargarse con cada servicio añadido, y el escaneo de assembly por reflexión en el
arranque desaparece.

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

`Program.cs` se reduce entonces a `builder.Services.AddGenerated();`. El código producido es visible,
depurable, y el compilador lo valida como el tuyo. Activa `<EmitCompilerGeneratedFiles>`
en el `.csproj` para recuperar los archivos `.g.cs` en disco y releerlos.

## Reportar diagnósticos

Un generador no solo produce código: también puede negarse a producirlo, y decirlo.
En lugar de emitir C# inválido cuando el atributo está mal aplicado, por ejemplo en un tipo abstracto,
se reporta un **diagnóstico**.

```csharp
private static readonly DiagnosticDescriptor MustBeConcrete = new(
    id: "MYAPP001",
    title: "Type non instanciable",
    messageFormat: "'{0}' est abstrait ou statique et ne peut pas être enregistré en DI",
    category: "DependencyInjection",
    DiagnosticSeverity.Error,
    isEnabledByDefault: true);
```

Se emite mediante `context.ReportDiagnostic(Diagnostic.Create(MustBeConcrete, location, typeName))`
en cuanto se detecta el caso. El error aparece en el editor, subrayado bajo el tipo problemático, en el
mismo lugar que un error del compilador, y nunca llega a ejecución.

## Build-time contra reflexión

El registro de DI es solo un ejemplo. La generación de mappers entre DTO y entidades, los
helpers de enum (parsing sin boxing, un `ToStringFast` sin asignación), la serialización:
en todas partes donde antes se escribía reflexión o código repetitivo a mano, un generador produce el
mismo resultado en la compilación, una sola vez, y de forma legible.

El ecosistema ha tomado esta dirección. `System.Text.Json` genera sus conversores mediante un
generador de source, y el logging de alto rendimiento de ASP.NET se escribe con `[LoggerMessage]`.
La razón de fondo va más allá de la velocidad: el código generado es **trimmable** y compatible
**AOT/Native**, donde la reflexión hace tropezar al enlazador. Y un error (un servicio
olvidado, un tipo no resuelto) surge en la compilación, no en la primera petición en producción.

El tutorial oficial cubre toda la superficie de la API en la
[doc Roslyn](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/source-generators-overview),
y el [documento de diseño de los generadores incrementales](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.md)
detalla el modelo de caché.

> Un source generator produce el código que habrías escrito a mano, pero es el compilador
> quien lo escribe y quien lo verifica. La metaprogramación se juega en la compilación, y la esencia del
> oficio es mantener el pipeline comparable por valor para que su caché aguante de una pulsación a
> otra.
