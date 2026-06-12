A clean Git history isn't vanity: it's what makes a review readable and a `git bisect`
effective. Interactive rebase (`git rebase -i`) is the tool to rewrite a branch before pushing
it — squash, rename, reorder, drop commits. Here's how to wield it without getting burned.

## Opening the todo

`git rebase -i` takes a **base**: every commit that comes after it becomes editable. You
usually target the last N commits of the current branch.

```bash
# Rewrite the last 4 commits
git rebase -i HEAD~4

# Or: everything between my branch and main
git rebase -i main
```

Git then opens a list, oldest at the top, newest at the bottom. Each line starts with a
command you replace:

```bash
pick a1b2c3d Add cart service
pick d4e5f6a Fix a typo
pick 7g8h9i0 Implement total
pick 1j2k3l4 wip
```

## The everyday commands

- `reword` (`r`): keep the commit but rewrite its message.
- `squash` (`s`): merge into the previous commit while **keeping** both messages.
- `fixup` (`f`): like squash, but **discard** the merged commit's message — perfect for a
  "wip" or a typo fix.
- `edit` (`e`): stop on the commit to amend the code or split it.
- `drop` (`d`): remove the commit entirely.

Reordering is just a matter of **moving the lines**. Here's the previous todo cleaned up:

```bash
pick a1b2c3d Add cart service
fixup d4e5f6a Fix a typo
pick 7g8h9i0 Implement total
fixup 1j2k3l4 wip
```

On save, Git replays the commits in the new order. If two changes touch the same line, a
**conflict** appears: resolve it, then `git add` and `git rebase --continue`. At any point,
`git rebase --abort` brings the branch back to its pre-rebase state.

### Automatic fixup

To prepare a fix aimed at a specific commit, `--fixup` then `--autosquash` order everything
for you:

```bash
git commit --fixup=7g8h9i0
git rebase -i --autosquash main
```

## The golden rule

**Never rebase shared history.** Rebase **rewrites** commits: their SHAs change. If the branch
is already on the remote and colleagues have pulled it, your `git push --force` will diverge
from their copy and cause nasty conflicts. So you rebase only a **local** branch not yet
pushed — or a branch you own alone, with a `git push --force-with-lease` that refuses to crush
unexpected work.

## Recovering after a mistake

A rebase gone wrong is never fatal: `git reflog` keeps a trace of **every** position of
`HEAD`, even the ones "lost" by the rewrite.

```bash
git reflog
# ... 89abcde HEAD@{5}: rebase (start): ...
git reset --hard HEAD@{5}
```

You get the branch back exactly as it was before the rebase. The reference is the
[git-rebase manual](https://git-scm.com/docs/git-rebase).

> Interactive rebase rewrites history to make it **tellable**: one commit = one idea, one
> clear message. Keep it local, secure your pushes with `--force-with-lease`, and remember the
> reflog is your safety net.
