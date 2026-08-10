The next `.NET` template engines compile. Razor goes through Roslyn, Handlebars emits IL, and the
first render pays the bill: tens of milliseconds of code generation before the first
byte.

In a long-lived process, this cost amortizes. In a serverless function or a
container started on demand, you pay it again on every wake-up.

[NgSharp](https://github.com/Nayruuu/NgSharp) does the opposite: the template is parsed into an AST then
**interpreted**. Nothing to compile, zero third-party dependencies, and v3 holds up in warm-path
comparisons too, benchmarks to back it up.

## The compilation cliff

Same 96-product catalog, same HTML output. RazorLight takes **~29 ms** on first render, the
time it takes Roslyn to compile. Handlebars, **~10 ms** of IL emission. NgSharp, **32 µs**.

The gap doesn't come from the rendering itself but from everything that doesn't happen: no
compilation, no generated code to load.

Code generation also has an access cost: Native AOT and *trimming* exclude Roslyn and
`Reflection.Emit`. An interpreted engine simply doesn't have that constraint.

## What interpreting means

A compiled engine translates the template into source code or IL, then lets the JIT turn it into
cached machine code. The first render pays for this translation; subsequent ones reuse the
code already produced. The trade-off pays off when the same template is rendered thousands of times
in a process that never restarts.

An interpreted engine stops earlier. The template is read only once, in two steps.

First the lexer splits the string into tokens: blocks of literal text and delimited expression
regions (`{{ }}`, control-flow blocks). Its only job is to find the
boundaries.

Then the parser assembles these tokens into a tree. Each language construct becomes a
node type: a literal carries static text, an interpolation carries an expression, a
loop carries its source and the body to repeat.

```csharp
// Conceptual shape of a template AST: one node type per construct.
abstract record Node;
record Literal(string Text) : Node;              // static markup, copied as-is
record Interpolation(Expr Value) : Node;         // {{ expr }}, escaped when written
record ForLoop(string Var, Expr Source, Node[] Body) : Node;
record If(Expr Condition, Node[] Then, Node[] Else) : Node;
```

This tree is built once. Nothing is compiled, nothing is emitted, nothing is loaded. This is
what makes the first render nearly free: all that's left is to walk the tree.

## Walking the tree on every render

Rendering means walking the tree depth-first and writing into an output buffer. A literal
node copies its text as-is. An interpolation evaluates its expression against the model and writes the
result, escaped. A loop evaluates its source and re-emits its body once per element.

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

The cost per render is this walk: a dispatch per node, model reads, and
string writes. Conventional wisdom says a compiler wins here, because it replaces
dispatch with straight-line code. The gap closes when the dominant work isn't
dispatch but text writing and model access: a template does little
arithmetic and a lot of concatenation.

What sinks a naive interpreter is allocation. A context object per node, an intermediate
string per interpolation, and the GC ends up dominating render time. An engine that wants
to hold up under load keeps this path allocation-free. That's precisely what the
v3 rewrite targets.

Escaping happens at write time, not at parse time. Literals pass through untouched; only
interpolated values are escaped before reaching the buffer. That's the boundary between
markup intended by the author and content coming from the data.

## Angular-style templates, without the dependency

The syntax mirrors Angular's: `{{ }}` interpolation, pipes, `[attr.x]` / `[class.x]`
bindings, server components, `@if` / `@for` / `@switch` control flow.

```csharp
var builder = HtmlBuilder.Create(); // pre-loaded with the built-in pipes

var html = builder.BuildFromTemplate(
    "<ul>@for (u of Users) {<li>{{ u.Name | upper }}</li>}</ul>",
    new { Users = new[] { new { Name = "ada" }, new { Name = "linus" } } });

// → <ul><li>ADA</li><li>LINUS</li></ul>
```

The HTML parser was written specifically for this, without AngleSharp. It does just one thing:
produce structurally correct, escaped output.

Since v3, the engine also accepts things other than HTML: `TemplateMode.Text` runs
plain text, JSON, or CSV through the same pipeline, for text emails and exports.

The [documentation](https://nayruuu.github.io/NgSharp/) walks through every directive, pipe, and binding
with runnable examples.

## What v3 changes

The core was rewritten: single-pass parser, lazy and copy-free model reads,
inline caches on property accesses, pipes formatted on `Span` with no allocation. The AST is
immutable and the renderer stateless, so a template parsed once renders in parallel, lock-free.

```csharp
builder.BuildFromTemplate(template, model, new TemplateOptions
{
    Strict = true,                      // fail loud: silent misses become NgSharpException
    Culture = new CultureInfo("fr-FR"), // per-render pipe formatting
    Limits = new RenderLimits(),        // resource caps
});
```

Strict mode turns silent failures into `NgSharpException`, and catches, right at template
analysis, an always-false condition or a division by a literal zero.

## Byte-identical output

Template engine comparisons rarely compare the same thing, since each engine renders
slightly different HTML. Here, the six engines measured (NgSharp, RazorLight, Handlebars,
Fluid, Scriban, Stubble) produce **byte-identical** output, and a CI gate
verifies it before measuring anything at all.

On the catalog, NgSharp renders warm in **25 µs** for **33 KB** allocated, ahead of every engine
measured, in both time and allocations. The whole thing is covered by **704 tests**.

## Where it runs

`netstandard2.1` and `net8.0`, `IsAotCompatible`, a single NuGet dependency (`System.Text.Json`).
The `TextWriter` and `RenderAsync` *sinks* write atomically: a render that fails
writes nothing at all. The package is on [NuGet](https://www.nuget.org/packages/NgSharp):
`dotnet add package NgSharp`.

> Compiling templates buys warm-path speed at the price of a cold-start cliff. v3
> shows the trade-off isn't mandatory: interpret, and still stay ahead when warm too.
> The benchmarks re-run with a single command from the repo.
