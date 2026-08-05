Die .NET-Template-Engines kompilieren. Razor läuft über Roslyn, Handlebars erzeugt IL, und das
erste Rendering zahlt die Rechnung: mehrere Dutzend Millisekunden Codegenerierung vor dem ersten
Byte.

In einem lange laufenden Prozess amortisiert sich dieser Aufwand. In einer Serverless-Funktion
oder einem bedarfsgesteuert gestarteten Container zahlt man ihn bei jedem Aufwachen erneut.

[NgSharp](https://github.com/Nayruuu/NgSharp) macht das Gegenteil: Das Template wird zu einem AST
geparst und dann **interpretiert**. Nichts zu kompilieren, keine Drittanbieter-Abhängigkeit, und
die v3 hält auch im Warmzustand dem Vergleich stand, mit Benchmarks als Beleg.

## Die Kompilierungsklippe

Derselbe Katalog mit 96 Produkten, dieselbe HTML-Ausgabe. RazorLight braucht **~29 ms** für das
erste Rendering, die Zeit, die Roslyn zum Kompilieren benötigt. Handlebars, **~10 ms** IL-Emission.
NgSharp, 32 µs.

Der Unterschied kommt nicht vom Rendering selbst, sondern von allem, was nicht stattfindet: keine
Kompilierung, kein generierter Code zum Laden.

Codegenerierung hat auch Zugangskosten: Native AOT und *Trimming* schließen Roslyn und
`Reflection.Emit` aus. Eine interpretierte Engine unterliegt dieser Einschränkung schlicht nicht.

## Was Interpretieren bedeutet

Eine kompilierte Engine übersetzt das Template in Quellcode oder IL und überlässt es dann dem JIT,
daraus gecachten Maschinencode zu erzeugen. Das erste Rendering zahlt für diese Übersetzung; die
folgenden nutzen den bereits erzeugten Code wieder. Der Tausch lohnt sich, wenn dasselbe Template
tausendfach in einem Prozess gerendert wird, der nie neu startet.

Eine interpretierte Engine hört früher auf. Das Template wird nur einmal gelesen, in zwei Schritten.

Zuerst zerlegt der Lexer die Zeichenkette in Tokens: Blöcke aus literalem Text und abgegrenzte
Ausdrucksregionen (`{{ }}`, Kontrollfluss-Blöcke). Seine einzige Aufgabe ist es, die Grenzen zu
finden.

Anschließend setzt der Parser diese Tokens zu einem Baum zusammen. Jede Sprachkonstruktion wird zu
einem Knotentyp: ein Literal trägt statischen Text, eine Interpolation trägt einen Ausdruck, eine
Schleife trägt ihre Quelle und den zu wiederholenden Rumpf.

```csharp
// Conceptual shape of a template AST: one node type per construct.
abstract record Node;
record Literal(string Text) : Node;              // static markup, copied as-is
record Interpolation(Expr Value) : Node;         // {{ expr }}, escaped when written
record ForLoop(string Var, Expr Source, Node[] Body) : Node;
record If(Expr Condition, Node[] Then, Node[] Else) : Node;
```

Dieser Baum wird einmal aufgebaut. Nichts wird kompiliert, nichts wird emittiert, nichts wird
geladen. Das macht das erste Rendering nahezu kostenlos: Es bleibt nur, den Baum zu durchlaufen.

## Den Baum bei jedem Rendering durchlaufen

Rendern heißt, den Baum in die Tiefe zu durchlaufen und in einen Ausgabepuffer zu schreiben. Ein
Literal-Knoten kopiert seinen Text unverändert. Eine Interpolation wertet ihren Ausdruck gegen das
Modell aus und schreibt das Ergebnis, escaped. Eine Schleife wertet ihre Quelle aus und gibt ihren
Rumpf einmal pro Element erneut aus.

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

Die Kosten pro Rendering sind dieser Durchlauf: eine Weiche pro Knoten, die Lesezugriffe auf das
Modell und das Schreiben der Zeichenketten. Das Lehrbuch sagt, ein Compiler gewinne hier, weil er
die Weiche durch geradlinigen Code ersetzt. Der Abstand schrumpft, wenn die dominierende Arbeit
nicht die Weiche ist, sondern das Schreiben von Text und der Zugriff auf das Modell: Ein Template
macht wenig Arithmetik und viel Konkatenation.

Was eine naive Interpreter-Implementierung ausbremst, ist die Allokation. Ein Kontextobjekt pro
Knoten, eine Zwischenzeichenkette pro Interpolation, und der GC dominiert am Ende die
Renderzeit. Eine Engine, die im Warmzustand mithalten will, hält diesen Pfad allokationsfrei.
Genau darauf zielt die Neufassung der v3 ab.

Das Escaping findet beim Schreiben statt, nicht beim Parsing. Literale durchlaufen unverändert;
nur die interpolierten Werte werden escaped, bevor sie den Puffer erreichen. Das ist die Grenze
zwischen dem vom Autor gewollten Markup und dem aus den Daten stammenden Inhalt.

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

Der HTML-Parser wurde eigens dafür geschrieben, ohne AngleSharp. Er tut nur eines: eine
strukturell korrekte und escapte Ausgabe erzeugen.

Seit der v3 akzeptiert die Engine auch anderes als HTML: `TemplateMode.Text` schickt reinen Text,
JSON oder CSV durch dieselbe Pipeline, für Text-E-Mails und Exporte.

Die [Dokumentation](https://nayruuu.github.io/NgSharp/) rollt jede Direktive, jede Pipe und jedes
Binding mit ausführbaren Beispielen aus.

## Was die v3 ändert

Der Kern wurde neu geschrieben: Parser in einem einzigen Durchgang, träges und kopierfreies Lesen
des Modells, Inline-Caches für Property-Zugriffe, auf `Span` formatierte Pipes ohne Allokation.
Der AST ist unveränderlich und der Renderer zustandslos, sodass ein einmal geparstes Template
parallel und ohne Lock gerendert werden kann.

```csharp
builder.BuildFromTemplate(template, model, new TemplateOptions
{
    Strict = true,                      // fail loud: silent misses become NgSharpException
    Culture = new CultureInfo("fr-FR"), // per-render pipe formatting
    Limits = new RenderLimits(),        // resource caps
});
```

Der strikte Modus verwandelt stille Fehlschläge in `NgSharpException` und erkennt bereits bei der
Analyse des Templates eine stets falsche Bedingung oder eine Division durch eine literale Null.

## Eine byte-identische Ausgabe

Vergleiche von Template-Engines vergleichen selten dasselbe, da jede Engine leicht
unterschiedliches HTML rendert. Hier erzeugen die sechs gemessenen Engines (NgSharp, RazorLight,
Handlebars, Fluid, Scriban, Stubble) eine **byte-identische** Ausgabe, und ein Gate in der CI
prüft das, bevor überhaupt irgendetwas gemessen wird.

Auf dem Katalog rendert NgSharp im Warmzustand in **25 µs** bei **33 KB** allozierter Speicher,
vor jeder gemessenen Engine, sowohl bei der Zeit als auch bei den Allokationen. Das Ganze wird von
**704 Tests** abgedeckt.

## Wo es läuft

`netstandard2.1` und `net8.0`, `IsAotCompatible`, eine einzige NuGet-Abhängigkeit
(`System.Text.Json`). Die *Sinks* `TextWriter` und `RenderAsync` schreiben atomar: Ein
fehlschlagendes Rendering schreibt gar nichts. Das Paket liegt auf
[NuGet](https://www.nuget.org/packages/NgSharp): `dotnet add package NgSharp`.

> Templates zu kompilieren erkauft Geschwindigkeit im Warmzustand um den Preis einer Klippe im
> Kaltzustand. Die v3 zeigt, dass dieser Tausch nicht zwingend ist: interpretieren, und auch im
> Warmzustand vorne bleiben. Die Benchmarks lassen sich mit einem einzigen Befehl aus dem Repo
> erneut ausführen.
