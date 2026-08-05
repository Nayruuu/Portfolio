Un historique lisible n'est pas cosmétique. Une revue se lit commit par commit, `git bisect`
suppose que chaque commit compile, et un `git log` clair sert de mémoire au projet. Le rebase
interactif est l'outil qui met une branche au propre avant de la pousser : réécrire un message,
fondre un « wip » dans le commit qu'il corrige, réordonner, découper, supprimer. Rien de magique,
juste Git qui rejoue vos commits un par un en vous laissant intervenir entre chaque.

## Ouvrir le todo

`git rebase -i` prend une **base**. Tous les commits situés après elle deviennent éditables. On
vise en général les N derniers commits de la branche, ou tout ce qui la sépare de `main`.

```bash
# The last 4 commits of the current branch
git rebase -i HEAD~4

# Every commit on this branch that isn't already on main
git rebase -i main
```

Git ouvre un fichier « todo » et le remplit du commit le plus ancien (en haut) au plus récent (en
bas). C'est l'ordre inverse de `git log`, et il vaut mieux l'avoir en tête avant de déplacer des
lignes.

```
pick a1b2c3d Ajoute le service de panier
pick d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
pick 1j2k3l4 wip
```

Chaque ligne commence par un verbe. Le travail consiste à remplacer ces verbes, à réordonner les
lignes, ou à en supprimer, puis à sauvegarder pour laisser Git rejouer la branche.

## Les verbes du todo

Sept commandes couvrent l'essentiel :

- `pick` (`p`) : appliquer le commit tel quel. C'est le défaut sur chaque ligne.
- `reword` (`r`) : appliquer le commit, mais rouvrir l'éditeur pour réécrire son message.
- `edit` (`e`) : appliquer le commit puis **s'arrêter**, `HEAD` posé dessus, pour amender le code
  ou le découper.
- `squash` (`s`) : fondre le commit dans celui de la ligne au-dessus, en concaténant les deux
  messages dans l'éditeur.
- `fixup` (`f`) : comme `squash`, mais **jeter** le message du commit absorbé. Le choix par défaut
  pour un « wip » ou une correction de typo.
- `drop` (`d`) : supprimer le commit. Effacer la ligne fait la même chose.
- `exec` (`x`) : ne touche à aucun commit, mais exécute le reste de la ligne dans un shell une fois
  arrivé à ce point du rejeu.

## Réordonner et fondre

Réordonner se fait en déplaçant les lignes. Reprenons le todo précédent, nettoyé : chaque
correction est collée sous le commit qu'elle répare, et fusionnée sans garder son message.

```
pick a1b2c3d Ajoute le service de panier
fixup d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
fixup 1j2k3l4 wip
```

À la sauvegarde, quatre commits deviennent deux, chacun avec un diff propre et un message qui tient
sans le code sous les yeux. Si deux modifications touchent la même ligne, le rejeu **s'interrompt**
sur le conflit : `git status` montre les fichiers concernés, vous les corrigez, `git add` marque la
résolution, puis `git rebase --continue` reprend. On ne fait pas de `git commit` : c'est `--continue`
qui recolle le commit en cours. Un commit devenu vide après résolution se saute avec
`git rebase --skip`, et `git rebase --abort` ramène la branche exactement à son état d'avant.

## Le fixup automatique

Quand vous repérez un bug dans un commit déjà relu, inutile de placer la ligne `fixup` à la main.
Indexez la correction, rattachez-la au commit visé, puis laissez `--autosquash` trier :

```bash
# Tie the staged fix to the commit it repairs
git commit --fixup=7g8h9i0

# Autosquash moves every fixup!/squash! next to its target and pre-marks it
git rebase -i --autosquash main
```

`--fixup` écrit un commit dont le message est `fixup! Implémente le total`. `--autosquash` lit ce
préfixe, déplace la ligne juste après sa cible dans le todo et la marque `fixup` pour vous.
`--squash=<sha>` fait pareil mais garde un brouillon de message via `squash`. Un
`git config --global rebase.autoSquash true` rend le comportement implicite, et le flag devient
inutile.

## Découper un commit

Un commit qui fait deux choses se coupe avec `edit`. Marquez-le, et le rejeu s'arrête pile dessus,
`HEAD` posé sur ce commit, l'arbre propre.

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

`git reset HEAD^` recule `HEAD` d'un commit et renvoie toutes ses modifications dans le répertoire
de travail (reset *mixed*, le défaut), ce qui vous laisse recomposer plusieurs commits. Si vous
préférez garder une partie indexée et ne défaire que le reste, `git reset -p HEAD^` fait le tri hunk
par hunk. Même logique pour tester chaque commit d'une série : `git rebase -i --exec "npm test"
HEAD~6` insère un `exec npm test` après chaque `pick` et s'arrête sur le premier commit qui vire au
rouge.

## Transplanter une branche avec `--onto`

La forme à trois arguments, `git rebase --onto <nouvelle-base> <ancienne-base> <branche>`, déplace
une plage de commits ailleurs. Le cas typique : vous avez ouvert `feature` au-dessus d'une branche
`spike` qui ne partira jamais en revue, et vous voulez replanter les seuls commits de `feature` sur
`main`.

```bash
# Replay spike..feature onto main, leaving spike behind
git rebase --onto main spike feature
```

Git prend les commits accessibles depuis `feature` mais pas depuis `spike`, et les rejoue sur
`main`. La même forme sert à retirer un commit au milieu d'une branche :
`git rebase --onto badcommit^ badcommit` rejoue tout ce qui suit `badcommit` sur son parent, ce qui
l'efface sans toucher au reste.

## La règle d'or

**Ne jamais rebaser un historique partagé.** Le rebase **réécrit** les commits : un SHA couvre le
contenu du commit et celui de son parent, donc rejouer une série leur donne à tous une nouvelle
identité. Une branche déjà poussée que des collègues ont récupérée va diverger de leur copie ; votre
`git push --force` écrase la référence commune et leur laisse des fusions pénibles à démêler.

On rebase donc une branche **locale** pas encore poussée, ou une branche dont on est le seul
propriétaire. Dans ce dernier cas, poussez avec `git push --force-with-lease` : il refuse d'écraser
si la référence distante a bougé depuis votre dernier `fetch`, là où `--force` écrase sans poser de
question.

## Le filet de sécurité

Un rebase qui tourne mal n'est jamais fatal. `git reflog` garde une trace de **chaque** position
qu'a occupée `HEAD`, y compris celles que la réécriture a « perdues ».

```bash
git reflog
# 89abcde HEAD@{5}: rebase (start): checkout main
git reset --hard HEAD@{5}
```

`HEAD@{5}` désigne l'endroit où la branche se tenait cinq déplacements plus tôt ; `reset --hard`
l'y remet au commit près. La documentation de référence reste le
[manuel git-rebase](https://git-scm.com/docs/git-rebase), qui détaille chaque verbe et chaque mode.

> Le rebase interactif rend une branche lisible : un commit par idée, un message qui tient sans le
> diff sous les yeux. Réservez-le au local, poussez avec `--force-with-lease`, et souvenez-vous que
> le reflog rattrape presque toutes les erreurs.
