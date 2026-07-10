Man erbt selten ein **Greenfield**. Meistens ist es ein .NET-Monolith, der seit acht
Jahren in Produktion läuft und den niemand anzufassen wagt. Das **Strangler-Fig**-Pattern
erlaubt es, ihn **Stück für Stück** zu ersetzen, ohne Big-Bang und ohne Ausfallfenster.

## Das Prinzip

Man platziert eine Fassade vor dem Monolithen und **leitet** eine Route nach der anderen
an einen neuen Service weiter. Solange eine Funktionalität nicht neu geschrieben ist,
läuft sie weiterhin über den alten Code. An dem Tag, an dem die letzte Route umgestellt
wird, ist der Monolith tot — erdrosselt.

### Eine Anti-Corruption Layer

Der neue Code soll nie die Sprache des Legacysystems sprechen. Man schaltet eine
**Anti-Corruption Layer** dazwischen, die die Modelle der alten Welt in die neue übersetzt:

```csharp
public sealed class LegacyOrderTranslator
{
    public Order ToDomain(LegacyOrderDto dto) => new(
        Id: new OrderId(dto.ORDER_ID),
        Total: Money.FromCents(dto.TOTAL_CENTS),
        PlacedAt: DateTime.SpecifyKind(dto.DT, DateTimeKind.Utc));
}
```

## Routing auf der richtigen Ebene

Die Umstellung erfolgt idealerweise auf Ebene des **Reverse-Proxys** (YARP, Nginx) statt
im Code, um beide Welten vollständig isoliert zu halten. Mit [YARP](https://microsoft.github.io/reverse-proxy/)
genügt eine einfache Konfigurationsroute, um einen Pfad zum neuen Service umzuleiten.

- eine migrierte Route → neuer Service
- eine noch nicht migrierte Route → Monolith
- ein Canary → 5 % des Traffics, dann 100 %

## Messen vor dem Abschalten

Jede migrierte Route wird mit einem **Shadow-Traffic** begleitet, der mit der alten Antwort
verglichen wird, bevor endgültig umgestellt wird. Der alte Code wird erst entfernt, wenn er
**nachweislich tot** ist: Solange noch ein Aufruf durch ihn hindurchläuft, bleibt er bestehen.
Die Telemetrie wird damit zum Schiedsrichter der Migration.

> Erdrosseln bedeutet nicht, schneller neu zu schreiben. Es bedeutet, **reversibel** neu
> zu schreiben: Auf jeder Stufe kann man mit einer einzigen Konfigurationszeile
> zurückrudern.
