.NET template engines compile. Razor goes through Roslyn, Handlebars emits IL, and the first
render foots the bill: tens of milliseconds of code generation before the first byte.

In a long-lived process, that cost gets amortized. In a serverless function or an on-demand
container, you pay it again on every wake-up.

[NgSharp](https://github.com/Nayruuu/NgSharp) does the opposite: the template is parsed into an
AST then **interpreted**. Nothing to compile, zero third-party dependencies, and v3 holds its
own on warm performance too, benchmarks to back it up.

## The compilation cliff

Same 96-product catalog, same HTML output. RazorLight takes **~29 ms** on first render, the
time for Roslyn to compile. Handlebars, **~10 ms** of IL emission. NgSharp, **32 µs**.

The gap doesn't come from the rendering itself but from everything that doesn't happen: no
compilation, no generated code to load.

Code generation also has an access cost: Native AOT and *trimming* exclude Roslyn and
`Reflection.Emit`. An interpreted engine simply doesn't have that constraint.

## Angular-style templates, no dependency

The syntax mirrors Angular's: `{{ }}` interpolation, pipes, `[attr.x]` / `[class.x]` bindings,
server components, `@if` / `@for` / `@switch` control flow.

```csharp
var builder = HtmlBuilder.Create(); // pre-loaded with the built-in pipes

var html = builder.BuildFromTemplate(
    "<ul>@for (u of Users) {<li>{{ u.Name | upper }}</li>}</ul>",
    new { Users = new[] { new { Name = "ada" }, new { Name = "linus" } } });

// → <ul><li>ADA</li><li>LINUS</li></ul>
```

The HTML parser is purpose-built, without AngleSharp. It does exactly one thing: produce
structurally correct, escaped output.

Since v3, the engine also accepts things other than HTML: `TemplateMode.Text` runs plain text,
JSON, or CSV through the same pipeline, for text emails and exports.

The [documentation](https://nayruuu.github.io/NgSharp/) walks through every directive, pipe,
and binding with runnable examples.

## What v3 changes

The core was rewritten: single-pass parser, lazy and copy-free model reads, inline caches on
property access, allocation-free `Span`-formatted pipes. The AST is immutable and the renderer
is stateless, so a template compiled once renders in parallel, lock-free.

```csharp
builder.BuildFromTemplate(template, model, new TemplateOptions
{
    Strict = true,                      // fail loud: silent misses become NgSharpException
    Culture = new CultureInfo("fr-FR"), // per-render pipe formatting
    Limits = new RenderLimits(),        // resource caps
});
```

Strict mode turns silent failures into `NgSharpException`, and catches an always-false
condition or a division by a literal zero right at template compilation.

## Byte-identical output

Template engine comparisons rarely compare the same thing, since each engine renders slightly
different HTML. Here, the six engines measured (NgSharp, RazorLight, Handlebars, Fluid,
Scriban, Stubble) produce **byte-identical** output, and a CI gate verifies this before
measuring anything at all.

On the catalog, NgSharp renders warm in **25 µs** for **33 KB** allocated, ahead of every
engine measured, both in time and in allocations. The whole thing is covered by **704 tests**.

## Where it runs

`netstandard2.1` and `net8.0`, `IsAotCompatible`, a single NuGet dependency
(`System.Text.Json`). The `TextWriter` and `RenderAsync` sinks write atomically: a failed
render writes nothing at all. The package is on
[NuGet](https://www.nuget.org/packages/NgSharp): `dotnet add package NgSharp`.

> Compiling templates buys warm-path speed at the price of a cold-start cliff. v3 shows the
> trade-off isn't mandatory: interpret, and still stay ahead on the warm path too.
> The benchmarks can be re-run with a single command from the repo.
