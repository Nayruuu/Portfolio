Los motores de plantillas .NET compilan. Razor pasa por Roslyn, Handlebars emite IL, y el
primer renderizado paga la factura: decenas de milisegundos de generación de código antes del
primer byte.

En un proceso de larga duración, este coste se amortiza. En una función serverless o un
contenedor arrancado bajo demanda, se vuelve a pagar en cada despertar.

[NgSharp](https://github.com/Nayruuu/NgSharp) hace lo contrario: la plantilla se parsea en AST y
luego se **interpreta**. Nada que compilar, cero dependencias de terceros, y la v3 también
aguanta la comparación en caliente, con benchmarks que lo respaldan.

## El precipicio de la compilación

Mismo catálogo de 96 productos, misma salida HTML. RazorLight tarda **~29 ms** en el primer
renderizado, el tiempo que Roslyn necesita para compilar. Handlebars, **~10 ms** de emisión IL.
NgSharp, **32 µs**.

La diferencia no viene del renderizado en sí, sino de todo lo que no ocurre: sin compilación,
sin código generado que cargar.

La generación de código también tiene un coste de acceso: Native AOT y el *trimming* excluyen
Roslyn y `Reflection.Emit`. Un motor interpretado simplemente no tiene esa restricción.

## Plantillas al estilo Angular, sin dependencias

La sintaxis retoma la de Angular: interpolación `{{ }}`, pipes, bindings `[attr.x]` /
`[class.x]`, componentes de servidor, control de flujo `@if` / `@for` / `@switch`.

```csharp
var builder = HtmlBuilder.Create(); // pre-loaded with the built-in pipes

var html = builder.BuildFromTemplate(
    "<ul>@for (u of Users) {<li>{{ u.Name | upper }}</li>}</ul>",
    new { Users = new[] { new { Name = "ada" }, new { Name = "linus" } } });

// → <ul><li>ADA</li><li>LINUS</li></ul>
```

El parser HTML se escribió para la ocasión, sin AngleSharp. Solo hace una cosa: producir una
salida estructuralmente correcta y escapada.

Desde la v3, el motor también acepta algo distinto de HTML: `TemplateMode.Text` hace pasar
texto plano, JSON o CSV por el mismo pipeline, para los correos de texto y las exportaciones.

La [documentación](https://nayruuu.github.io/NgSharp/) recorre cada directiva, pipe y binding
con ejemplos ejecutables.

## Lo que cambia la v3

El núcleo se reescribió: parser en una sola pasada, lecturas del modelo perezosas y sin copia,
cachés inline en los accesos a propiedades, pipes formateados sobre `Span` sin asignación. El
AST es inmutable y el renderer no tiene estado, así que una plantilla compilada una vez se
renderiza en paralelo, sin bloqueo.

```csharp
builder.BuildFromTemplate(template, model, new TemplateOptions
{
    Strict = true,                      // fail loud: silent misses become NgSharpException
    Culture = new CultureInfo("fr-FR"), // per-render pipe formatting
    Limits = new RenderLimits(),        // resource caps
});
```

El modo estricto convierte los fallos silenciosos en `NgSharpException`, y detecta desde la
compilación de la plantilla una condición siempre falsa o una división por un cero literal.

## Una salida idéntica byte a byte

Los comparativos de motores de plantillas rara vez comparan lo mismo, ya que cada motor
renderiza un HTML ligeramente distinto. Aquí, los seis motores medidos (NgSharp, RazorLight,
Handlebars, Fluid, Scriban, Stubble) producen una salida **idéntica byte a byte**, y un gate en
CI lo verifica antes de medir nada.

Sobre el catálogo, NgSharp renderiza en caliente en **25 µs** con **33 KB** asignados, por
delante de cada motor medido, tanto en tiempo como en asignaciones. El conjunto está cubierto
por **704 tests**.

## Dónde funciona

`netstandard2.1` y `net8.0`, `IsAotCompatible`, una única dependencia NuGet
(`System.Text.Json`). Los *sinks* `TextWriter` y `RenderAsync` escriben de forma atómica: un
renderizado que falla no escribe nada en absoluto. El paquete está en
[NuGet](https://www.nuget.org/packages/NgSharp): `dotnet add package NgSharp`.

> Compilar plantillas compra velocidad en caliente al precio de un precipicio en frío. La v3
> demuestra que el intercambio no es obligatorio: interpretar, y seguir por delante también en
> caliente. Los benchmarks se vuelven a lanzar con un solo comando desde el repo.
