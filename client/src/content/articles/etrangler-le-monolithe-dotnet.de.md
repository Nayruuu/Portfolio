Man erbt selten ein jungfräuliches Projekt. Meist handelt es sich um einen .NET-Monolithen, der seit
acht Jahren in Produktion läuft, den niemand mehr am Stück durchliest und den das Team scheut
anzufassen. Der Reflex ist, eine komplette Neuentwicklung zu fordern. Das **Strangler-Fig**-Pattern,
beschrieben von [Martin Fowler](https://martinfowler.com/bliki/StranglerFigApplication.html), schlägt
das Gegenteil vor: den Monolithen umschließen und ihn dann Funktion für Funktion ersetzen, bis nichts
mehr übrig bleibt, das abgeschaltet werden müsste.

## Warum keine Neuentwicklung am Stück

Eine komplette Neuentwicklung zielt auf ein bewegliches Ziel. Während der Monate, in denen das Team
neu baut, liefert der Monolithe weiterhin Korrekturen und Funktionen, die die neue Version noch vor
ihrer Fertigstellung nachholen muss.

Am Tag der Umschaltung geht alles gleichzeitig live. Die kleinste Regression betrifft das gesamte
Produkt, und ein Rollback bedeutet, das gesamte alte System neu bereitzustellen.

Der Strangler verlagert das Risiko. Statt einer einzigen, unumkehrbaren Umschaltung erhält man eine
Reihe kleiner Umschaltungen, jede auf eine Route begrenzt, jede rückgängig machbar. Die Neuentwicklung
läuft nicht schneller, aber sie liefert bei jedem Schritt Wert, ohne jemals das gesamte Produkt aufs
Spiel zu setzen.

## Zuerst die Fassade

Bevor irgendetwas extrahiert wird, platziert man einen Interception-Punkt vor dem Monolithen. Ein
Reverse Proxy empfängt den gesamten Traffic und leitet ihn vorerst ausnahmslos an den alten Code
weiter. Funktional ändert dieses erste Deployment nichts, und genau das macht es sicher auszuliefern.

Dieser Interception-Punkt ist das Herzstück des Patterns. Solange er nicht existiert, zwingt das
Umleiten einer Route dazu, den Monolithen selbst zu verändern. Sobald er vorhanden ist, passt die
Umschaltung einer Funktion in eine einzige Konfigurationszeile, ohne den alten Code neu zu
kompilieren.

In .NET übernimmt [YARP](https://microsoft.github.io/reverse-proxy/) diese Rolle im selben Prozess,
konfigurationsgesteuert. Die spezifischste Route gewinnt: `/orders/...` geht an den neuen Service, der
Catch-all leitet den Rest an den Monolithen.

```json
{
  "ReverseProxy": {
    "Routes": {
      "orders-v2": { "ClusterId": "orders-service", "Match": { "Path": "/orders/{*rest}" } },
      "legacy":    { "ClusterId": "monolith",       "Match": { "Path": "/{*rest}" } }
    },
    "Clusters": {
      "orders-service": { "Destinations": { "d1": { "Address": "https://orders.internal/" } } },
      "monolith":       { "Destinations": { "d1": { "Address": "https://legacy.internal/" } } }
    }
  }
}
```

## Die erste Naht auswählen

Nicht jede Funktion ist ein guter Kandidat für die erste Extraktion. Gesucht wird ein **Bounded
Context** im Sinne von [Domain-Driven Design](https://martinfowler.com/bliki/BoundedContext.html):
eine kohärente Einheit mit klarer Grenze und wenigen Abhängigkeiten, die sie durchqueren.

Der gute erste Kandidat ist lose an den Rest gekoppelt: wenige geteilte Tabellen, wenige
Querverweise zum Kern des Monolithen. Er tut auch irgendwo weh, entweder weil er sich häufig ändert
oder weil er eine Last trägt, mit der der alte Code schlecht zurechtkommt.

Das Gegenteil wird vermieden: das zentrale Modul, das alle aufrufen, oder die Tabelle, mit der die
Hälfte aller Anfragen einen Join durchführt. Die Abrechnung wird selten als Erstes extrahiert. Man
beginnt mit einer peripheren Naht, an der ein Fehlschlag beherrschbar bleibt: ein lesbarer
Katalog, ein Benachrichtigungsservice, ein Export.

## Die Anti-Corruption Layer

Der neue Service darf niemals die Sprache des Legacy-Systems sprechen. Spalten in Großbuchstaben,
numerische Statuscodes, Datumswerte ohne Zeitzone: Diese ererbten Entscheidungen dürfen die Grenze
nicht überschreiten und das neue Modell kontaminieren. Man schaltet eine **Anti-Corruption Layer**
dazwischen, ein Begriff von Eric Evans, deren einzige Aufgabe darin besteht, von der einen Welt in
die andere zu übersetzen.

Konkret handelt es sich um eine Schicht am Eingang des Service. Sie nimmt das DTO, so wie der
Monolithe es liefert, und wandelt es in ein sauberes Domänenmodell mit starken Typen um.

```csharp
// Translates the legacy contract into the new domain model. Nothing past this
// point knows the monolith's column names, status codes or naked timestamps.
public sealed class LegacyOrderTranslator
{
    public Order ToDomain(LegacyOrderDto dto) => new(
        Id: new OrderId(dto.ORDER_ID),
        Status: MapStatus(dto.STATUS_CODE),
        Total: Money.FromCents(dto.TOTAL_CENTS, dto.CURRENCY),
        PlacedAt: DateTime.SpecifyKind(dto.DT, DateTimeKind.Utc));

    private static OrderStatus MapStatus(int code) => code switch
    {
        10 => OrderStatus.Pending,
        20 => OrderStatus.Paid,
        30 => OrderStatus.Shipped,
        _ => throw new UnknownLegacyStatusException(code),
    };
}
```

Die Übersetzung erfolgt in beide Richtungen, solange der Monolithe die Quelle der Wahrheit bleibt:
Der Service liest aus dem Legacy-System, wendet seine Logik an und schreibt dann in das Format
zurück, das der alte Code erwartet. Diese Schicht ist auch der einzige Ort, der die Eigenheiten des
alten Schemas kennt. Sobald das Legacy-System verschwindet, wird der Übersetzer entfernt, und sonst
bewegt sich nichts.

## Die Datenhoheit migrieren

Das ist der Schritt, den der Proxy nicht löst. Eine Anfrage zu routen ist einfach; die Daten, die sie
liest und schreibt, zu verschieben, ist wesentlich schwieriger.

Anfangs teilt sich der extrahierte Service oft die Datenbank des Monolithen. Er liest und schreibt
dieselben Tabellen, was jede Synchronisation überflüssig macht, aber dazu führt, dass zwei Codebasen
auf denselben Daten koexistieren. Das ist ein Übergangszustand, akzeptabel für die Zeit, in der die
Route stabilisiert wird, aber kein Endziel.

Das Ziel ist, dass die Naht ihre eigenen Daten besitzt. Der Service erhält seinen eigenen Datenbestand,
und einer der beiden Schreibpfade wird zur Referenz. Um die Konsistenz während des Übergangs zu
halten, schreibt man auf beiden Seiten (Double Write) oder, sicherer, veröffentlicht die Änderungen
des Monolithen über eine Outbox oder Change Data Capture (CDC), die der neue Service konsumiert.

## Umschalten, dann messen

Eine Route springt nicht auf einmal auf 100 % des Traffics. Man beginnt mit einem **Kanarienvogel**:
Ein kleiner Anteil der Anfragen geht an den neuen Service, der Rest läuft weiter über den
Monolithen. Halten Fehlerquote und Latenz stand, wird der Anteil erhöht, bis die alte Route
abgeschaltet werden kann.

Vor der Abschaltung will man den Beweis, dass der neue Pfad wie der alte antwortet. Shadow Traffic
sendet dieselbe Anfrage an beide Implementierungen, liefert dem Nutzer die Antwort des Monolithen
aus und vergleicht die des neuen Service im Hintergrund, ohne sie jemals sichtbar zu machen.

```csharp
// Shadow the request to the new service, keep serving the monolith's answer,
// and log any divergence for offline review. The user never sees v2 yet.
var legacy = await _monolith.GetOrderAsync(id, ct);

_ = Task.Run(async () =>
{
    var candidate = await _ordersV2.GetOrderAsync(id, ct);
    if (!OrderComparer.Equivalent(legacy, candidate))
    {
        _log.LogWarning("Shadow divergence on order {Id}", id);
    }
});

return legacy;
```

Die durch diesen Vergleich gemeldeten Abweichungen bilden die Aufgabenliste vor der Umschaltung. Ist
sie leer, kann der Kanarienvogel ohne Risiko hochgefahren werden.

## Den alten Pfad entfernen

Eine migrierte Funktion hinterlässt Legacy-Code, der nicht mehr gebraucht wird. Die Versuchung ist,
ihn vorsichtshalber zu behalten. So endet ein ausgehungerter Monolithe mit zwei Implementierungen von
allem, keine davon entfernt.

Die Regel: Ein Pfad wird erst entfernt, wenn er **nachweislich tot** ist. Die Telemetrie des Proxys
zeigt, wie viele Aufrufe noch über die alte Route laufen. Solange der Zähler in einem
repräsentativen Fenster nicht bei null liegt, bleibt der Code bestehen. Sobald er bei null ist, wird
die Legacy-Route entfernt, dann der Code, den sie bediente, dann die Spalten, die niemand mehr
liest.

Der Monolithe schrumpft mit jeder entfernten Naht. Das Pattern endet von selbst: Wenn die letzte
Route umgeschaltet ist, bleibt nichts mehr, das an den alten Prozess geroutet werden müsste, und man
schaltet ihn ab.

> Der Strangler beschleunigt die Neuentwicklung nicht, er macht sie reversibel. Jeder Schritt liefert
> eine Naht hinter dem Proxy, validiert sich unter Shadow Traffic und lässt sich in einer
> Konfigurationszeile rückgängig machen. Das Risiko konzentriert sich nicht mehr auf eine einzige
> Umschaltung, sondern verteilt sich auf eine Reihe kleiner Schritte, von denen jeder scheitern kann,
> ohne das Produkt mitzureißen.
