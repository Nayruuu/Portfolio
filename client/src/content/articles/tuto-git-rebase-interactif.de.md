Ein sauberer Git-Verlauf macht eine Review lesbar und ein `git bisect` effizient. Der interaktive
Rebase (`git rebase -i`) ist das Werkzeug, um einen Branch vor dem Pushen umzuschreiben:
Commits zusammenführen, umbenennen, neu ordnen, löschen. Hier erfahren Sie, wie Sie ihn handhaben,
ohne einen geteilten Branch zu zerstören.

## Die Todo-Liste öffnen

`git rebase -i` benötigt eine **Basis**: Alle Commits, die danach kommen, werden bearbeitbar.
Man zielt in der Regel auf die letzten N Commits des aktuellen Branches ab.

```bash
# Rewrite the last 4 commits
git rebase -i HEAD~4

# Or: everything between my branch and main
git rebase -i main
```

Git öffnet daraufhin eine Liste, vom ältesten (oben) zum neuesten (unten) Commit. Jede Zeile
beginnt mit einem Befehl, den man ersetzt:

```bash
pick a1b2c3d Warenkorb-Service hinzufügen
pick d4e5f6a Tippfehler korrigieren
pick 7g8h9i0 Summe implementieren
pick 1j2k3l4 wip
```

## Die alltäglichen Befehle

- `reword` (`r`): den Commit behalten, aber seine Nachricht neu schreiben.
- `squash` (`s`): mit dem vorherigen Commit zusammenführen, wobei **beide** Nachrichten
  erhalten bleiben.
- `fixup` (`f`): wie squash, aber die Nachricht des zusammengeführten Commits **verwerfen**,
  perfekt für ein „wip“ oder eine Tippfehler-Korrektur.
- `edit` (`e`): beim Commit anhalten, um den Code zu ändern oder ihn aufzuteilen.
- `drop` (`d`): den Commit vollständig löschen.

Neu ordnen erfolgt durch **Verschieben der Zeilen**. Hier die vorherige Todo-Liste bereinigt:

```bash
pick a1b2c3d Warenkorb-Service hinzufügen
fixup d4e5f6a Tippfehler korrigieren
pick 7g8h9i0 Summe implementieren
fixup 1j2k3l4 wip
```

Beim Speichern spielt Git die Commits in der neuen Reihenfolge ab. Wenn zwei Änderungen dieselbe
Zeile betreffen, erscheint ein **Konflikt**: Man löst ihn, dann `git add` und `git rebase
--continue`. Jederzeit bringt `git rebase --abort` den Branch zurück in seinen vorherigen
Zustand.

### Der automatische Fixup

Um eine Korrektur für einen bestimmten Commit vorzubereiten, ordnen `--fixup` und dann
`--autosquash` alles für dich:

```bash
git commit --fixup=7g8h9i0
git rebase -i --autosquash main
```

## Die goldene Regel

**Niemals einen geteilten Verlauf rebasen.** Der Rebase **schreibt** die Commits **um**: Ihre
SHA-Werte ändern sich.

Wenn der Branch bereits im Remote-Repository liegt und Kollegen ihn abgerufen haben, wird Ihr
`git push --force` von ihrer Kopie abweichen und unangenehme Konflikte verursachen.

Rebasen Sie also nur einen **lokalen**, noch nicht gepushten Branch. Oder einen Branch, dessen
alleiniger Besitzer Sie sind, mit einem `git push --force-with-lease`, das sich weigert,
unerwartete Arbeit zu überschreiben.

## Nach einem Fehler wiederherstellen

Ein misslungener Rebase ist nie fatal: `git reflog` protokolliert **jede** Position von
`HEAD`, selbst jene, die durch das Umschreiben „verloren“ gingen.

```bash
git reflog
# ... 89abcde HEAD@{5}: rebase (start): ...
git reset --hard HEAD@{5}
```

Man findet den Branch genau so wieder, wie er vor dem Rebase war. Die Referenzdokumentation ist
das [git-rebase-Handbuch](https://git-scm.com/docs/git-rebase).

> Der interaktive Rebase schreibt die Geschichte um, um sie **erzählbar** zu machen: ein Commit =
> eine Idee, eine klare Nachricht. Nutzen Sie ihn nur lokal, sichern Sie Ihre Pushes mit
> `--force-with-lease` und denken Sie daran, dass das Reflog Ihr Sicherheitsnetz ist.
