Traducción del artículo del francés al español, respetando bloques de código, enlaces y términos técnicos.

Los motores de plantillas .NET compilan. Razor pasa por Roslyn, Handlebars emite IL, y el
primer render paga la factura: decenas de milisegundos de generación de código antes del primer
byte.

En un proceso que vive mucho tiempo, este coste se amortiza. En una función serverless o un
contenedor arrancado bajo demanda, se vuelve a pagar en cada despertar.

[NgSharp](https://github.com/Nayruuu/NgSharp) hace lo contrario: la plantilla se parsea en AST y
luego se **interpreta**. Nada que compilar, cero dependencias de terceros, y la v3 también
aguanta la comparación en caliente, benchmarks en mano.

## El precipicio de la compilación

Mismo catálogo de 96 productos, misma salida HTML. RazorLight tarda **~29 ms** en el primer
render, el tiempo que Roslyn necesita para compilar. Handlebars, **~10 ms** de emisión de IL.
NgSharp, **32 µs**.

La diferencia no viene del renderizado en sí, sino de todo lo que no ocurre: nada de
compilación, nada de código generado que cargar.

La generación de código también tiene un coste de acceso: Native AOT y el *trimming* excluyen
Roslyn y `Reflection.Emit`. Un motor interpretado simplemente no tiene esa restricción.

## Lo que significa interpretar

Un motor compilado traduce la plantilla a código fuente o a IL, y luego deja que el JIT lo
convierta en código máquina en caché. El primer render paga esa traducción; los siguientes
reutilizan el código ya producido. El intercambio es rentable cuando una misma plantilla se
renderiza miles de veces en un proceso que nunca se reinicia.

Un motor interpretado se detiene antes. La plantilla se lee solo una vez, en dos fases.

Primero el lexer descompone la cadena en tokens: bloques de texto literal y regiones de
expresión delimitadas (`{{ }}`, bloques de control de flujo). Su único trabajo es encontrar los
límites.

Luego el parser ensambla esos tokens en un árbol. Cada construcción del lenguaje se convierte en
un tipo de nodo: un literal contiene texto estático, una interpolación contiene una expresión,
un bucle contiene su fuente y el cuerpo a repetir.

```csharp
// Conceptual shape of a template AST: one node type per construct.
abstract record Node;
record Literal(string Text) : Node;              // static markup, copied as-is
record Interpolation(Expr Value) : Node;         // {{ expr }}, escaped when written
record ForLoop(string Var, Expr Source, Node[] Body) : Node;
record If(Expr Condition, Node[] Then, Node[] Else) : Node;
```

Este árbol se construye una sola vez. Nada se compila, nada se emite, nada se carga. Esto es lo
que hace que el primer render sea casi gratuito: solo queda recorrer el árbol.

## Recorrer el árbol en cada render

Renderizar es caminar el árbol en profundidad y escribir en un buffer de salida. Un nodo literal
copia su texto tal cual. Una interpolación evalúa su expresión contra el modelo y escribe el
resultado, escapado. Un bucle evalúa su fuente y reemite su cuerpo una vez por elemento.

```csharp
// Render = walk the tree once, writing straight into the output buffer.
void Write(Node node, Scope scope, IBufferWriter<char> output)
{
    switch (node)
    {
        case Literal l:       output.Write(l.Text); break;
        case Interpolation i: output.WriteEscaped(Eval(i.Value, scope)); break;
        case ForLoop f:
            foreach (var item in Eval(f.Source, scope))
                foreach (var child in f.Body)
                    Write(child, scope.With(f.Var, item), output);
            break;
        // ... one arm per node type
    }
}
```

El coste por render es este recorrido: una bifurcación por nodo, las lecturas del modelo, y la
escritura de las cadenas. El manual dice que un compilador gana aquí, porque reemplaza la
bifurcación por código directo. La diferencia se reduce cuando el trabajo dominante no es la
bifurcación sino la escritura de texto y el acceso al modelo: una plantilla hace poca
aritmética y mucha concatenación.

Lo que hunde a un intérprete ingenuo es la asignación de memoria. Un objeto de contexto por
nodo, una cadena intermedia por interpolación, y el GC acaba dominando el tiempo de render. Un
motor que quiere aguantar en caliente mantiene esta ruta sin asignaciones. Es precisamente lo
que persigue la reescritura de la v3.

El escape se gestiona en la escritura, no en el parsing. Los literales atraviesan intactos;
solo los valores interpolados se escapan antes de llegar al buffer. Es la frontera entre el
marcado deseado por el autor y el contenido proveniente de los datos.

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

Desde la v3, el motor también acepta algo más que HTML: `TemplateMode.Text` permite pasar texto
plano, JSON o CSV por el mismo pipeline, para los correos de texto y las exportaciones.

La [documentación](https://nayruuu.github.io/NgSharp/) detalla cada directiva, pipe y binding
con ejemplos ejecutables.

## Lo que cambia la v3

El núcleo se reescribió: parser de una sola pasada, lecturas del modelo perezosas y sin copia,
cachés inline en los accesos a propiedades, pipes formateados sobre `Span` sin asignaciones. El
AST es inmutable y el renderer no tiene estado, así que una plantilla parseada una vez se
renderiza en paralelo, sin bloqueo.

```csharp
builder.BuildFromTemplate(template, model, new TemplateOptions
{
    Strict = true,                      // fail loud: silent misses become NgSharpException
    Culture = new CultureInfo("fr-FR"), // per-render pipe formatting
    Limits = new RenderLimits(),        // resource caps
});
```

El modo estricto transforma los fallos silenciosos en `NgSharpException`, y detecta ya desde el
análisis de la plantilla una condición siempre falsa o una división por un cero literal.

## Una salida idéntica byte a byte

Los comparativos de motores de plantillas raramente comparan lo mismo, ya que cada motor
renderiza un HTML ligeramente distinto. Aquí, los seis motores medidos (NgSharp, RazorLight,
Handlebars, Fluid, Scriban, Stubble) producen una salida **idéntica byte a byte**, y una
comprobación en CI lo verifica antes de medir nada.

Sobre el catálogo, NgSharp renderiza en caliente en **25 µs** con **33 Ko** asignados, por
delante de cada motor medido, tanto en tiempo como en asignaciones. El conjunto está cubierto
por **704 tests**.

## Dónde funciona

`netstandard2.1` y `net8.0`, `IsAotCompatible`, una única dependencia NuGet
(`System.Text.Json`). Los *sinks* `TextWriter` y `RenderAsync` escriben de forma atómica: un
render que falla no escribe nada en absoluto. El paquete está en
[NuGet](https://www.nuget.org/packages/NgSharp): `dotnet add package NgSharp`.

> Compilar plantillas compra velocidad en caliente al precio de un precipicio en frío. La v3
> muestra que el intercambio no es obligatorio: interpretar, y seguir por delante también en
> caliente. Los benchmarks se relanzan con un solo comando desde el repositorio.
