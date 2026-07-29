Eine saubere Git-Historie ist keine Spielerei: Sie macht eine Review lesbar und ein `git bisect` effektiv. Der interaktive Rebase (`git rebase -i`) ist das Werkzeug, um einen Branch vor dem Pushen umzuschreiben — Commits zusammenführen, umbenennen, umsortieren, entfernen. So handhabt man ihn, ohne sich zu verbrennen.

## Das Todo öffnen

`git rebase -i` nimmt eine **Basis**: Alle Commits, die danach kommen, werden editierbar. In der Regel zielt man auf die letzten N Commits des aktuellen Branches.

```bash
# Réécrire les 4 derniers commits
git rebase -i HEAD~4

# Ou : tout ce qui sépare ma branche de main
git rebase -i main
```

Git öffnet dann eine Liste, vom ältesten (oben) zum neuesten (unten). Jede Zeile beginnt mit einem Befehl, den man ersetzen kann:

```bash
pick a1b2c3d Ajoute le service de panier
pick d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
pick 1j2k3l4 wip
```

## Die wichtigsten Befehle

- `reword` (`r`) : den Commit behalten, aber seine Nachricht neu schreiben.
- `squash` (`s`) : in den vorherigen Commit zusammenführen und dabei **beide** Nachrichten beibehalten.
- `fixup` (`f`) : wie squash, aber die Nachricht des zusammengeführten Commits **verwerfen** — ideal für ein „wip" oder eine Tippfehlerkorrektur.
- `edit` (`e`) : beim Commit pausieren, um den Code zu ändern oder aufzuteilen.
- `drop` (`d`) : den Commit vollständig entfernen.

Umsortieren erfolgt einfach durch **Verschieben der Zeilen**. So sieht das obige Todo bereinigt aus:

```bash
pick a1b2c3d Ajoute le service de panier
fixup d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
fixup 1j2k3l4 wip
```

Beim Speichern spielt Git die Commits in der neuen Reihenfolge ab. Berühren zwei Änderungen dieselbe Zeile, entsteht ein **Konflikt**: Man löst ihn auf, dann `git add` und `git rebase --continue`. Jederzeit bringt `git rebase --abort` den Branch in seinen ursprünglichen Zustand zurück.

### Das automatische Fixup

Um eine Korrektur für einen bestimmten Commit vorzubereiten, ordnen `--fixup` und anschließend `--autosquash` alles automatisch:

```bash
git commit --fixup=7g8h9i0
git rebase -i --autosquash main
```

## Die goldene Regel

**Niemals eine geteilte Historie rebasieren.** Rebase **schreibt** Commits um: Ihre SHAs ändern sich. Wenn der Branch bereits im Remote-Repository liegt und Kollegen ihn ausgecheckt haben, wird Ihr `git push --force` von ihrer Kopie abweichen und unangenehme Konflikte verursachen. Man rebasiert daher ausschließlich einen **lokalen** Branch, der noch nicht gepusht wurde — oder einen Branch, dessen alleiniger Eigentümer man ist, mit `git push --force-with-lease`, das das Überschreiben unerwarteter Arbeit verweigert.

## Nach einem Fehler wiederherstellen

Ein schief gelaufener Rebase ist niemals fatal: `git reflog` bewahrt eine Spur von **jeder** Position von `HEAD`, auch jener, die durch das Umschreiben „verloren" gegangen sind.

```bash
git reflog
# ... 89abcde HEAD@{5}: rebase (start): ...
git reset --hard HEAD@{5}
```

Man findet den Branch genau so wieder, wie er vor dem Rebase war. Die Referenzdokumentation ist das [git-rebase-Handbuch](https://git-scm.com/docs/git-rebase).

> Der interaktive Rebase schreibt die Geschichte um, damit sie **erzählbar** wird: ein Commit = eine Idee, eine klare Nachricht. Halte ihn lokal, sichere deine Pushs mit `--force-with-lease`, und denk daran, dass das Reflog dein Sicherheitsnetz ist.
