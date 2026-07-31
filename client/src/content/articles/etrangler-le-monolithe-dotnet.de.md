Man erbt selten ein **Greenfield**. Meistens ist es ein .NET-Monolith, der seit acht Jahren
in Produktion läuft und den niemand anzufassen wagt. Das **Strangler-Fig**-Pattern erlaubt
es, ihn **Stück für Stück** zu ersetzen, ohne Big Bang und ohne Wartungsfenster.

## Das Prinzip

Man stellt eine Fassade vor den Monolithen und leitet dann eine Route nach der anderen auf
einen neuen Service um. Solange eine Funktionalität nicht neu geschrieben ist, läuft sie
weiter über den alten Code. An dem Tag, an dem die letzte Route umgestellt ist, läuft
nichts mehr über den Monolithen: Man kann ihn abschalten.

### Eine Anti-Corruption Layer

Der neue Code darf nie die Sprache des Legacy-Systems sprechen. Man schaltet eine
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

## Auf der richtigen Ebene routen

Die Umstellung erfolgt idealerweise auf Ebene des **Reverse Proxy** (YARP, Nginx) statt im
Code, damit die beiden Welten getrennt bleiben. Mit [YARP](https://microsoft.github.io/reverse-proxy/)
genügt eine einfache Konfigurationsroute, um einen Pfad auf den neuen Service umzuleiten.

- eine migrierte Route → neuer Service
- eine nicht migrierte Route → Monolith
- ein Canary → 5 % des Traffics, dann 100 %

## Messen, bevor man kappt

Jede migrierte Route wird mit **Shadow Traffic** doppelt gefahren und mit der alten Antwort
verglichen, bevor endgültig gekappt wird. Der alte Code wird erst entfernt, wenn er
**nachweislich tot** ist: Solange noch ein Aufruf darüber läuft, bleibt er. Die Telemetrie
entscheidet über die Migration.

> Der Strangler beschleunigt das Neuschreiben nicht, er macht es **reversibel**: Jeder
> Schritt lässt sich mit einer einzigen Konfigurationszeile rückgängig machen.
