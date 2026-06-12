Un historique Git propre n'est pas de la coquetterie : c'est ce qui rend une revue lisible et
un `git bisect` efficace. Le rebase interactif (`git rebase -i`) est l'outil pour réécrire une
branche avant de la pousser — fusionner, renommer, réordonner, supprimer des commits. Voici
comment le manier sans se brûler.

## Ouvrir le todo

`git rebase -i` prend une **base** : tous les commits qui viennent après elle deviennent
éditables. On vise généralement les N derniers commits de la branche courante.

```bash
# Réécrire les 4 derniers commits
git rebase -i HEAD~4

# Ou : tout ce qui sépare ma branche de main
git rebase -i main
```

Git ouvre alors une liste, du plus ancien (en haut) au plus récent (en bas). Chaque ligne
commence par une commande qu'on remplace :

```bash
pick a1b2c3d Ajoute le service de panier
pick d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
pick 1j2k3l4 wip
```

## Les commandes du quotidien

- `reword` (`r`) : garder le commit mais réécrire son message.
- `squash` (`s`) : fusionner dans le commit précédent en **conservant** les deux messages.
- `fixup` (`f`) : comme squash, mais **jeter** le message du commit fusionné — parfait pour
  un « wip » ou une correction de typo.
- `edit` (`e`) : s'arrêter sur le commit pour modifier le code ou le découper.
- `drop` (`d`) : supprimer le commit entièrement.

Réordonner se fait simplement en **déplaçant les lignes**. Voici le todo précédent nettoyé :

```bash
pick a1b2c3d Ajoute le service de panier
fixup d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
fixup 1j2k3l4 wip
```

À la sauvegarde, Git rejoue les commits dans le nouvel ordre. Si deux modifications touchent
la même ligne, un **conflit** apparaît : on le résout, puis `git add` et `git rebase
--continue`. À tout moment, `git rebase --abort` ramène la branche à son état d'avant.

### Le fixup automatique

Pour préparer une correction destinée à un commit précis, `--fixup` puis `--autosquash`
ordonnent tout pour vous :

```bash
git commit --fixup=7g8h9i0
git rebase -i --autosquash main
```

## La règle d'or

**Ne jamais rebaser un historique partagé.** Le rebase **réécrit** les commits : leurs SHA
changent. Si la branche est déjà sur le dépôt distant et que des collègues l'ont récupérée,
votre `git push --force` divergera de leur copie et provoquera des conflits désagréables. On
rebase donc uniquement une branche **locale**, pas encore poussée — ou une branche dont on est
le seul propriétaire, avec un `git push --force-with-lease` qui refuse d'écraser un travail
inattendu.

## Récupérer après une erreur

Un rebase qui tourne mal n'est jamais fatal : `git reflog` garde une trace de **chaque**
position de `HEAD`, même celles « perdues » par la réécriture.

```bash
git reflog
# ... 89abcde HEAD@{5}: rebase (start): ...
git reset --hard HEAD@{5}
```

On retrouve la branche exactement telle qu'elle était avant le rebase. La doc de référence est
le [manuel git-rebase](https://git-scm.com/docs/git-rebase).

> Le rebase interactif réécrit l'histoire pour la rendre **racontable** : un commit = une idée,
> un message clair. Garde-le pour le local, sécurise tes pushs avec `--force-with-lease`, et
> souviens-toi que le reflog est ton filet.
