Ich übersetze den Artikel jetzt direkt ins Deutsche unter Beibehaltung von Code, Links und Struktur.

Eine lesbare Historie ist keine Kosmetik. Ein Review liest sich Commit für Commit, `git bisect`
setzt voraus, dass jeder Commit kompiliert, und ein klares `git log` dient dem Projekt als
Gedächtnis. Der interaktive Rebase ist das Werkzeug, das einen Branch aufräumt, bevor man ihn
pusht: eine Message umschreiben, ein „wip" in den Commit einschmelzen, den es korrigiert,
umordnen, aufteilen, löschen. Nichts Magisches, Git spielt einfach eure Commits einzeln nach und
lässt euch zwischen jedem eingreifen.

## Die Todo-Liste öffnen

`git rebase -i` nimmt eine **Basis**. Alle Commits danach werden editierbar. Man zielt im
Allgemeinen auf die letzten N Commits des Branches, oder auf alles, was ihn von `main` trennt.

```bash
# The last 4 commits of the current branch
git rebase -i HEAD~4

# Every commit on this branch that isn't already on main
git rebase -i main
```

Git öffnet eine „Todo"-Datei und füllt sie vom ältesten Commit (oben) bis zum jüngsten (unten).
Das ist die umgekehrte Reihenfolge zu `git log`, und man sollte das im Kopf haben, bevor man
Zeilen verschiebt.

```
pick a1b2c3d Ajoute le service de panier
pick d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
pick 1j2k3l4 wip
```

Jede Zeile beginnt mit einem Verb. Die Arbeit besteht darin, diese Verben zu ersetzen, die Zeilen
umzuordnen oder welche zu löschen, und dann zu speichern, damit Git den Branch nachspielt.

## Die Verben der Todo-Liste

Sieben Befehle decken das Wesentliche ab:

- `pick` (`p`): den Commit unverändert anwenden. Das ist der Standard auf jeder Zeile.
- `reword` (`r`): den Commit anwenden, aber den Editor erneut öffnen, um seine Message
  umzuschreiben.
- `edit` (`e`): den Commit anwenden und dann **anhalten**, `HEAD` darauf positioniert, um den Code
  zu ändern oder ihn aufzuteilen.
- `squash` (`s`): den Commit mit dem der Zeile darüber verschmelzen, wobei beide Messages im
  Editor zusammengeführt werden.
- `fixup` (`f`): wie `squash`, aber die Message des absorbierten Commits wird **verworfen**. Die
  Standardwahl für ein „wip" oder eine Tippfehlerkorrektur.
- `drop` (`d`): den Commit löschen. Die Zeile zu entfernen bewirkt dasselbe.
- `exec` (`x`): rührt keinen Commit an, führt aber den Rest der Zeile in einer Shell aus, sobald
  dieser Punkt im Nachspielen erreicht ist.

## Umordnen und Verschmelzen

Umordnen erfolgt durch Verschieben der Zeilen. Nehmen wir die vorige Todo-Liste, aufgeräumt: jede
Korrektur wird unter den Commit geklebt, den sie repariert, und ohne ihre Message zu behalten
zusammengeführt.

```
pick a1b2c3d Ajoute le service de panier
fixup d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
fixup 1j2k3l4 wip
```

Beim Speichern werden aus vier Commits zwei, jeder mit einem sauberen Diff und einer Message, die
ohne den Code vor Augen verständlich bleibt. Berühren zwei Änderungen dieselbe Zeile,
**unterbricht** das Nachspielen beim Konflikt: `git status` zeigt die betroffenen Dateien, ihr
korrigiert sie, `git add` markiert die Auflösung, dann nimmt `git rebase --continue` den Faden
wieder auf. Man macht kein `git commit`: `--continue` ist es, das den laufenden Commit wieder
zusammensetzt. Ein Commit, der nach der Auflösung leer geworden ist, wird mit
`git rebase --skip` übersprungen, und `git rebase --abort` bringt den Branch exakt in seinen
Zustand von vorher zurück.

## Der automatische Fixup

Wenn ihr einen Bug in einem bereits durchgesehenen Commit entdeckt, ist es unnötig, die
`fixup`-Zeile von Hand zu platzieren. Indiziert die Korrektur, verknüpft sie mit dem angepeilten
Commit, und lasst `--autosquash` sortieren:

```bash
# Tie the staged fix to the commit it repairs
git commit --fixup=7g8h9i0

# Autosquash moves every fixup!/squash! next to its target and pre-marks it
git rebase -i --autosquash main
```

`--fixup` schreibt einen Commit, dessen Message `fixup! Implémente le total` lautet.
`--autosquash` liest dieses Präfix, verschiebt die Zeile direkt hinter ihr Ziel in der Todo-Liste
und markiert sie für euch als `fixup`. `--squash=<sha>` macht dasselbe, behält aber einen
Message-Entwurf über `squash`. Ein `git config --global rebase.autoSquash true` macht das
Verhalten implizit, und das Flag wird überflüssig.

## Einen Commit aufteilen

Ein Commit, der zwei Dinge tut, wird mit `edit` zerschnitten. Markiert ihn, und das Nachspielen
hält genau darauf an, `HEAD` auf diesem Commit positioniert, der Baum sauber.

```bash
git rebase -i HEAD~3
# change 'pick' to 'edit' on the fat commit, save and quit

# The rebase pauses there. Rewind the commit, then re-commit in slices:
git reset HEAD^        # undo the commit; its changes return to the working tree
git add -p             # stage only the first coherent chunk
git commit -m "Extract the cart total helper"
git add -p
git commit -m "Wire the total into the checkout"
git rebase --continue
```

`git reset HEAD^` setzt `HEAD` um einen Commit zurück und gibt alle seine Änderungen an das
Arbeitsverzeichnis zurück (Reset *mixed*, der Standard), was euch erlaubt, mehrere Commits neu
zusammenzustellen. Wenn ihr lieber einen Teil indiziert behaltet und nur den Rest rückgängig
macht, sortiert `git reset -p HEAD^` Hunk für Hunk. Dieselbe Logik gilt, um jeden Commit einer
Serie zu testen: `git rebase -i --exec "npm test" HEAD~6` fügt nach jedem `pick` ein
`exec npm test` ein und hält beim ersten Commit an, der ins Rote kippt.

## Einen Branch mit `--onto` verpflanzen

Die dreiargumentige Form, `git rebase --onto <nouvelle-base> <ancienne-base> <branche>`,
verschiebt einen Bereich von Commits woandershin. Der typische Fall: ihr habt `feature` oberhalb
eines `spike`-Branches geöffnet, der nie in Review gehen wird, und wollt nur die Commits von
`feature` auf `main` neu einpflanzen.

```bash
# Replay spike..feature onto main, leaving spike behind
git rebase --onto main spike feature
```

Git nimmt die Commits, die von `feature` aus erreichbar sind, aber nicht von `spike` aus, und
spielt sie auf `main` nach. Dieselbe Form dient dazu, einen Commit mitten in einem Branch zu
entfernen: `git rebase --onto badcommit^ badcommit` spielt alles, was auf `badcommit` folgt, auf
dessen Parent nach, was ihn löscht, ohne den Rest zu berühren.

## Die goldene Regel

**Niemals eine geteilte Historie rebasen.** Der Rebase **schreibt** die Commits um: ein SHA deckt
den Inhalt des Commits und den seines Parents ab, also gibt das Nachspielen einer Serie ihnen
allen eine neue Identität. Ein bereits gepushter Branch, den Kollegen abgeholt haben, weicht von
deren Kopie ab; euer `git push --force` überschreibt die gemeinsame Referenz und hinterlässt ihnen
mühsame Merges zum Entwirren.

Man rebast also einen **lokalen** Branch, der noch nicht gepusht wurde, oder einen Branch, dessen
alleiniger Eigentümer man ist. In letzterem Fall pusht mit `git push --force-with-lease`: er
verweigert das Überschreiben, wenn sich die Remote-Referenz seit eurem letzten `fetch` bewegt hat,
während `force` überschreibt, ohne Fragen zu stellen.

## Das Sicherheitsnetz

Ein schiefgelaufener Rebase ist nie fatal. `git reflog` behält eine Spur von **jeder** Position,
die `HEAD` eingenommen hat, einschließlich derer, die das Umschreiben „verloren" hat.

```bash
git reflog
# 89abcde HEAD@{5}: rebase (start): checkout main
git reset --hard HEAD@{5}
```

`HEAD@{5}` bezeichnet die Stelle, an der der Branch fünf Verschiebungen zuvor stand;
`reset --hard` bringt ihn passgenau dorthin zurück. Die Referenzdokumentation bleibt das
[git-rebase-Handbuch](https://git-scm.com/docs/git-rebase), das jedes Verb und jeden Modus
detailliert beschreibt.

> Der interaktive Rebase macht einen Branch lesbar: ein Commit pro Idee, eine Message, die ohne
> den Diff vor Augen verständlich bleibt. Behaltet ihn dem Lokalen vor, pusht mit
> `--force-with-lease`, und denkt daran, dass das Reflog fast alle Fehler auffängt.
