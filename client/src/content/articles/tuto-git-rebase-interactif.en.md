A readable history isn't cosmetic. A review is read commit by commit, `git bisect`
assumes that every commit compiles, and a clear `git log` serves as the project's memory. Interactive
rebase is the tool that tidies up a branch before pushing it: rewriting a message, folding a "wip"
into the commit it fixes, reordering, splitting, deleting. Nothing magic,
just Git replaying your commits one by one while letting you intervene between each one.

## Opening the todo

`git rebase -i` takes a **base**. All commits located after it become editable. You generally
target the last N commits of the branch, or everything separating it from `main`.

```bash
# The last 4 commits of the current branch
git rebase -i HEAD~4

# Every commit on this branch that isn't already on main
git rebase -i main
```

Git opens a "todo" file and fills it from the oldest commit (at the top) to the most recent (at the
bottom). This is the reverse order of `git log`, and it's best to keep that in mind before moving
lines around.

```
pick a1b2c3d Ajoute le service de panier
pick d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
pick 1j2k3l4 wip
```

Each line starts with a verb. The work consists of replacing these verbs, reordering the
lines, or deleting some, then saving to let Git replay the branch.

## The todo verbs

Seven commands cover the essentials:

- `pick` (`p`): apply the commit as-is. This is the default on every line.
- `reword` (`r`): apply the commit, but reopen the editor to rewrite its message.
- `edit` (`e`): apply the commit then **stop**, with `HEAD` sitting on it, to amend the code
  or split it.
- `squash` (`s`): fold the commit into the one on the line above, concatenating both
  messages in the editor.
- `fixup` (`f`): like `squash`, but **discard** the message of the absorbed commit. The default choice
  for a "wip" or a typo fix.
- `drop` (`d`): delete the commit. Erasing the line does the same thing.
- `exec` (`x`): doesn't touch any commit, but runs the rest of the line in a shell once
  it reaches that point in the replay.

## Reordering and folding

Reordering is done by moving lines. Let's revisit the previous todo, cleaned up: each
fix is glued under the commit it repairs, and merged without keeping its message.

```
pick a1b2c3d Ajoute le service de panier
fixup d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
fixup 1j2k3l4 wip
```

On save, four commits become two, each with a clean diff and a message that holds up
without the code in front of you. If two changes touch the same line, the replay **stops**
on the conflict: `git status` shows the affected files, you fix them, `git add` marks the
resolution, then `git rebase --continue` resumes. You don't run `git commit`: it's `--continue`
that reattaches the current commit. A commit that becomes empty after resolution is skipped with
`git rebase --skip`, and `git rebase --abort` returns the branch exactly to its state before.

## Automatic fixup

When you spot a bug in a commit that's already been reviewed, there's no need to place the
`fixup` line by hand. Stage the fix, attach it to the targeted commit, then let `--autosquash` sort it out:

```bash
# Tie the staged fix to the commit it repairs
git commit --fixup=7g8h9i0

# Autosquash moves every fixup!/squash! next to its target and pre-marks it
git rebase -i --autosquash main
```

`--fixup` writes a commit whose message is `fixup! Implémente le total`. `--autosquash` reads this
prefix, moves the line right after its target in the todo and marks it `fixup` for you.
`--squash=<sha>` does the same but keeps a draft message via `squash`. A
`git config --global rebase.autoSquash true` makes the behavior implicit, and the flag becomes
unnecessary.

## Splitting a commit

A commit that does two things is split with `edit`. Mark it, and the replay stops right on it,
with `HEAD` sitting on that commit, the tree clean.

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

`git reset HEAD^` moves `HEAD` back one commit and returns all its changes to the working
directory (mixed reset, the default), which lets you recompose several commits. If you
prefer to keep part staged and only undo the rest, `git reset -p HEAD^` sorts it out hunk
by hunk. Same logic to test each commit in a series: `git rebase -i --exec "npm test"
HEAD~6` inserts an `exec npm test` after each `pick` and stops on the first commit that turns
red.

## Transplanting a branch with `--onto`

The three-argument form, `git rebase --onto <new-base> <old-base> <branch>`, moves
a range of commits elsewhere. The typical case: you opened `feature` on top of a `spike`
branch that will never go up for review, and you want to replant only the commits from `feature` onto
`main`.

```bash
# Replay spike..feature onto main, leaving spike behind
git rebase --onto main spike feature
```

Git takes the commits reachable from `feature` but not from `spike`, and replays them on
`main`. The same form is used to remove a commit in the middle of a branch:
`git rebase --onto badcommit^ badcommit` replays everything that follows `badcommit` onto its parent, which
erases it without touching the rest.

## The golden rule

**Never rebase shared history.** Rebase **rewrites** commits: a SHA covers the
content of the commit and that of its parent, so replaying a series gives them all a new
identity. A branch already pushed that colleagues have pulled will diverge from their copy; your
`git push --force` overwrites the shared reference and leaves them with painful merges to untangle.

So you rebase a **local** branch not yet pushed, or a branch you're the sole
owner of. In the latter case, push with `git push --force-with-lease`: it refuses to overwrite
if the remote reference has moved since your last `fetch`, unlike `--force`, which overwrites without asking
any questions.

## The safety net

A rebase gone wrong is never fatal. `git reflog` keeps a record of **every** position
`HEAD` has occupied, including the ones the rewrite "lost."

```bash
git reflog
# 89abcde HEAD@{5}: rebase (start): checkout main
git reset --hard HEAD@{5}
```

`HEAD@{5}` designates where the branch stood five moves earlier; `reset --hard`
puts it back there, down to the commit. The reference documentation remains the
[git-rebase manual](https://git-scm.com/docs/git-rebase), which details every verb and every mode.

> Interactive rebase makes a branch readable: one commit per idea, a message that holds up
> without the diff in front of you. Reserve it for local use, push with `--force-with-lease`, and
> remember that reflog catches almost every mistake.
