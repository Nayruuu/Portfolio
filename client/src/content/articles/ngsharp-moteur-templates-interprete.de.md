.NET-Template-Engines kompilieren. Razor geht durch Roslyn, Handlebars emittiert IL, und das
erste Rendering zahlt die Rechnung: Dutzende Millisekunden Codegenerierung vor dem ersten Byte.

In einem langlebigen Prozess amortisiert sich das. In einer Serverless-Funktion oder einem
Container, der auf Abruf startet, fällt es bei jedem Aufwachen erneut an.

[NgSharp](https://github.com/Nayruuu/NgSharp) macht das Gegenteil: das Template wird zu einem AST
geparst und dann **interpretiert**. Nichts zu kompilieren, null Fremdabhängigkeiten, und die v3
hält auch im warmen Zustand mit, Benchmarks inklusive.

## Die Kompilierungsklippe

Gleicher Katalog mit 96 Produkten, gleiche HTML-Ausgabe. RazorLight braucht **~29 ms** für das
erste Rendering, solange Roslyn kompiliert. Handlebars, **~10 ms** IL-Emission. NgSharp,
**32 µs**.

Der Abstand kommt nicht vom Rendering selbst, sondern von allem, was nicht stattfindet: keine
Kompilierung, kein generierter Code, der geladen werden muss.

Codegenerierung hat außerdem einen Zugangspreis: Native AOT und das *Trimming* schließen Roslyn
und `Reflection.Emit` aus. Eine interpretierte Engine hat diese Einschränkung schlicht nicht.

## Templates im Angular-Stil, ohne Abhängigkeit

Die Syntax übernimmt die von Angular: Interpolation `{{ }}`, Pipes, Bindings `[attr.x]` /
`[class.x]`, Server-Komponenten, Kontrollfluss `@if` / `@for` / `@switch`.

```csharp
var builder = HtmlBuilder.Create(); // pre-loaded with the built-in pipes

var html = builder.BuildFromTemplate(
    "<ul>@for (u of Users) {<li>{{ u.Name | upper }}</li>}</ul>",
    new { Users = new[] { new { Name = "ada" }, new { Name = "linus" } } });

// → <ul><li>ADA</li><li>LINUS</li></ul>
```

Der HTML-Parser ist eigens dafür geschrieben, ohne AngleSharp. Er kann nur eines: strukturell
korrekte, escapte Ausgabe erzeugen.

Seit der v3 akzeptiert die Engine auch anderes als HTML: `TemplateMode.Text` schickt Rohtext,
JSON oder CSV durch dieselbe Pipeline, für Text-E-Mails und Exporte.

Die [Dokumentation](https://nayruuu.github.io/NgSharp/) führt jede Direktive, Pipe und jedes
Binding mit ausführbaren Beispielen vor.

## Was die v3 ändert

Der Kern wurde neu geschrieben: Parser in einem einzigen Durchlauf, träge Modell-Lesezugriffe
ohne Kopie, Inline-Caches auf Property-Zugriffen, Pipes, die ohne Allokation auf `Span`
formatieren. Der AST ist unveränderlich und der Renderer zustandslos, ein einmal kompiliertes
Template rendert also parallel, ohne Lock.

```csharp
builder.BuildFromTemplate(template, model, new TemplateOptions
{
    Strict = true,                      // fail loud: silent misses become NgSharpException
    Culture = new CultureInfo("fr-FR"), // per-render pipe formatting
    Limits = new RenderLimits(),        // resource caps
});
```

Der Strict-Modus verwandelt stille Fehlschläge in `NgSharpException` und fängt schon beim
Kompilieren des Templates eine immer-falsche Bedingung oder eine Division durch eine
Null-Konstante ab.

## Byte-identische Ausgabe

Vergleiche von Template-Engines vergleichen selten dasselbe, weil jede Engine leicht anderes
HTML rendert. Hier erzeugen die sechs gemessenen Engines (NgSharp, RazorLight, Handlebars,
Fluid, Scriban, Stubble) eine **byte-identische** Ausgabe, und ein Gate in der CI prüft das,
bevor überhaupt gemessen wird.

Auf dem Katalog rendert NgSharp warm in **25 µs** bei **33 KB** Allokation, vor jeder gemessenen
Engine, in Zeit wie in Allokationen. Das Ganze ist mit **704 Tests** abgedeckt.

## Wo es läuft

`netstandard2.1` und `net8.0`, `IsAotCompatible`, eine einzige NuGet-Abhängigkeit
(`System.Text.Json`). Die *Sinks* `TextWriter` und `RenderAsync` schreiben atomar: ein
fehlgeschlagenes Rendering schreibt gar nichts. Das Paket liegt auf
[NuGet](https://www.nuget.org/packages/NgSharp): `dotnet add package NgSharp`.

> Templates zu kompilieren kauft warme Geschwindigkeit zum Preis einer kalten Klippe. Die v3
> zeigt, dass dieser Tausch nicht nötig ist: interpretieren, und auch warm vorn bleiben. Die
> Benchmarks lassen sich mit einem Befehl aus dem Repo neu ausführen.
