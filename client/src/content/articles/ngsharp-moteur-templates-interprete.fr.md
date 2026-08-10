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

## Ce qu'interpréter veut dire

Un moteur compilé traduit le template en code source ou en IL, puis laisse le JIT en faire du
code machine mis en cache. Le premier rendu paie cette traduction ; les suivants réutilisent le
code déjà produit. L'échange est rentable quand un même template est rendu des milliers de fois
dans un process qui ne redémarre jamais.

Un moteur interprété s'arrête plus tôt. Le template n'est lu qu'une fois, en deux temps.

D'abord le lexer découpe la chaîne en jetons : des blocs de texte littéral et des régions
d'expression délimitées (`{{ }}`, blocs de contrôle de flux). Son seul travail est de trouver
les frontières.

Ensuite le parser assemble ces jetons en arbre. Chaque construction du langage devient un type
de nœud : un littéral porte du texte statique, une interpolation porte une expression, une
boucle porte sa source et le corps à répéter.

```csharp
// Conceptual shape of a template AST: one node type per construct.
abstract record Node;
record Literal(string Text) : Node;              // static markup, copied as-is
record Interpolation(Expr Value) : Node;         // {{ expr }}, escaped when written
record ForLoop(string Var, Expr Source, Node[] Body) : Node;
record If(Expr Condition, Node[] Then, Node[] Else) : Node;
```

Cet arbre se construit une fois. Rien n'est compilé, rien n'est émis, rien n'est chargé. C'est
ce qui rend le premier rendu quasi gratuit : il ne reste plus qu'à parcourir l'arbre.

## Parcourir l'arbre à chaque rendu

Rendre, c'est marcher l'arbre en profondeur et écrire dans un buffer de sortie. Un nœud littéral
recopie son texte tel quel. Une interpolation évalue son expression contre le modèle et écrit le
résultat, échappé. Une boucle évalue sa source et réémet son corps une fois par élément.

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

Le coût par rendu, c'est cette marche : un aiguillage par nœud, les lectures du modèle, et
l'écriture des chaînes. Le manuel dit qu'un compilateur gagne ici, parce qu'il remplace
l'aiguillage par du code droit. L'écart se referme quand le travail dominant n'est pas
l'aiguillage mais l'écriture de texte et l'accès au modèle : un template fait peu d'arithmétique
et beaucoup de concaténation.

Ce qui coule un interpréteur naïf, c'est l'allocation. Un objet de contexte par nœud, une chaîne
intermédiaire par interpolation, et le GC finit par dominer le temps de rendu. Un moteur qui veut
tenir à chaud garde ce chemin sans allocation. C'est précisément ce que vise la réécriture de la
v3.

L'échappement se joue à l'écriture, pas au parsing. Les littéraux traversent intacts ; seules les
valeurs interpolées sont échappées avant d'atteindre le buffer. C'est la frontière entre le
balisage voulu par l'auteur et le contenu venu des données.

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
immuable et le renderer sans état, donc un template parsé une fois se rend en parallèle, sans
verrou.

```csharp
builder.BuildFromTemplate(template, model, new TemplateOptions
{
    Strict = true,                      // fail loud: silent misses become NgSharpException
    Culture = new CultureInfo("fr-FR"), // per-render pipe formatting
    Limits = new RenderLimits(),        // resource caps
});
```

Le mode strict transforme les échecs silencieux en `NgSharpException`, et attrape dès l'analyse
du template une condition toujours fausse ou une division par un zéro littéral.

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
