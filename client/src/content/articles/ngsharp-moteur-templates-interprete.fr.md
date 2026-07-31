Les moteurs de templates .NET compilent. Razor passe par Roslyn, Handlebars émet de l'IL, et le
premier rendu paie la note : des dizaines de millisecondes de génération de code avant le premier
octet.

Dans un process qui vit longtemps, ce coût s'amortit. Dans une fonction serverless ou un
conteneur démarré à la demande, on le repaie à chaque réveil.

[NgSharp](https://github.com/Nayruuu/NgSharp) fait l'inverse : le template est parsé en AST puis
**interprété**. Rien à compiler, zéro dépendance tierce, et la v3 soutient la comparaison à chaud
aussi, benchmarks à l'appui.

## La falaise de compilation

Même catalogue de 96 produits, même sortie HTML. RazorLight met **~29 ms** au premier rendu, le
temps que Roslyn compile. Handlebars, **~10 ms** d'émission IL. NgSharp, **32 µs**.

L'écart ne vient pas du rendu lui-même mais de tout ce qui n'a pas lieu : pas de compilation,
pas de code généré à charger.

La génération de code a aussi un coût d'accès : Native AOT et le *trimming* excluent Roslyn et
`Reflection.Emit`. Un moteur interprété n'a simplement pas cette contrainte.

## Des templates façon Angular, sans dépendance

La syntaxe reprend celle d'Angular : interpolation `{{ }}`, pipes, bindings `[attr.x]` /
`[class.x]`, composants serveur, contrôle de flux `@if` / `@for` / `@switch`.

```csharp
var builder = HtmlBuilder.Create(); // pre-loaded with the built-in pipes

var html = builder.BuildFromTemplate(
    "<ul>@for (u of Users) {<li>{{ u.Name | upper }}</li>}</ul>",
    new { Users = new[] { new { Name = "ada" }, new { Name = "linus" } } });

// → <ul><li>ADA</li><li>LINUS</li></ul>
```

Le parser HTML est écrit pour l'occasion, sans AngleSharp. Il ne fait qu'une chose : produire une
sortie structurellement correcte et échappée.

Depuis la v3, le moteur accepte aussi autre chose que du HTML : `TemplateMode.Text` fait passer
du texte brut, du JSON ou du CSV dans le même pipeline, pour les e-mails texte et les exports.

La [documentation](https://nayruuu.github.io/NgSharp/) déroule chaque directive, pipe et binding
avec des exemples exécutables.

## Ce que la v3 change

Le cœur a été réécrit : parser en passe unique, lectures du modèle paresseuses et sans copie,
caches inline sur les accès de propriétés, pipes formatés sur `Span` sans allocation. L'AST est
immuable et le renderer sans état, donc un template compilé une fois se rend en parallèle, sans
verrou.

```csharp
builder.BuildFromTemplate(template, model, new TemplateOptions
{
    Strict = true,                      // fail loud: silent misses become NgSharpException
    Culture = new CultureInfo("fr-FR"), // per-render pipe formatting
    Limits = new RenderLimits(),        // resource caps
});
```

Le mode strict transforme les échecs silencieux en `NgSharpException`, et attrape dès la
compilation du template une condition toujours fausse ou une division par un zéro littéral.

## Une sortie identique au byte près

Les comparatifs de moteurs de templates comparent rarement la même chose, chaque moteur rendant
un HTML légèrement différent. Ici, les six moteurs mesurés (NgSharp, RazorLight, Handlebars,
Fluid, Scriban, Stubble) produisent une sortie **identique au byte près**, et un gate en CI le
vérifie avant de mesurer quoi que ce soit.

Sur le catalogue, NgSharp rend à chaud en **25 µs** pour **33 Ko** alloués, devant chaque moteur
mesuré, en temps comme en allocations. L'ensemble est couvert par **704 tests**.

## Où ça tourne

`netstandard2.1` et `net8.0`, `IsAotCompatible`, une seule dépendance NuGet (`System.Text.Json`).
Les *sinks* `TextWriter` et `RenderAsync` écrivent de façon atomique : un rendu qui échoue
n'écrit rien du tout. Le paquet est sur [NuGet](https://www.nuget.org/packages/NgSharp) :
`dotnet add package NgSharp`.

> Compiler des templates achète de la vitesse à chaud au prix d'une falaise à froid. La v3
> montre que l'échange n'est pas obligatoire : interpréter, et rester devant à chaud aussi.
> Les benchmarks se relancent en une commande depuis le repo.
