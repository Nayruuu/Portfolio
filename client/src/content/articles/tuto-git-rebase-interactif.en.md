A clean Git history makes for a readable review and an effective `git bisect`. Interactive rebase
(`git rebase -i`) is the tool for rewriting a branch before pushing it:
merging, renaming, reordering, deleting commits. Here's how to handle it without breaking
a shared branch.

## Opening the todo

`git rebase -i` takes a **base**: every commit that comes after it becomes
editable. You'll generally target the last N commits of the current branch.

```bash
# Rewrite the last 4 commits
git rebase -i HEAD~4

# Or: everything between my branch and main
git rebase -i main
```

Git then opens a list, from oldest (at the top) to most recent (at the bottom). Each line
starts with a command that you replace:

```bash
pick a1b2c3d Add cart service
pick d4e5f6a Fix a typo
pick 7g8h9i0 Implement total
pick 1j2k3l4 wip
```

## The everyday commands

- `reword` (`r`): keep the commit but rewrite its message.
- `squash` (`s`): merge into the previous commit while **keeping** both messages.
- `fixup` (`f`): like squash, but **discard** the message of the merged commit, perfect for
  a "wip" or a typo fix.
- `edit` (`e`): stop on the commit to modify the code or split it up.
- `drop` (`d`): remove the commit entirely.

Reordering is done by **moving the lines**. Here's the previous todo cleaned up:

```bash
pick a1b2c3d Add cart service
fixup d4e5f6a Fix a typo
pick 7g8h9i0 Implement total
fixup 1j2k3l4 wip
```

On save, Git replays the commits in the new order. If two changes touch
the same line, a **conflict** appears: you resolve it, then `git add` and `git rebase
--continue`. At any point, `git rebase --abort` returns the branch to its previous state.

### Automatic fixup

To prepare a fix intended for a specific commit, `--fixup` then `--autosquash`
order everything for you:

```bash
git commit --fixup=7g8h9i0
git rebase -i --autosquash main
```

## The golden rule

**Never rebase shared history.** Rebase **rewrites** commits: their SHAs
change.

If the branch is already on the remote repository and colleagues have pulled it, your
`git push --force` will diverge from their copy and cause unpleasant conflicts.

So you only rebase a **local** branch, not yet pushed. Or a branch you
alone own, with a `git push --force-with-lease` that refuses to overwrite unexpected
work.

## Recovering after a mistake

A rebase gone wrong is never fatal: `git reflog` keeps a record of **every**
`HEAD` position, even those "lost" by the rewrite.

```bash
git reflog
# ... 89abcde HEAD@{5}: rebase (start): ...
git reset --hard HEAD@{5}
```

You get the branch back exactly as it was before the rebase. The reference doc is
the [git-rebase manual](https://git-scm.com/docs/git-rebase).

> Interactive rebase rewrites history to make it **tellable**: one commit = one idea,
> a clear message. Keep it for local use, secure your pushes with `--force-with-lease`, and
> remember that the reflog is your safety net.
