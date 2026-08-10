---
description: Record a summary of the current session into .sessions/ (local, not committed)
---

Write a journal entry for the current session into the `.sessions/` folder (gitignored — never
commit it). Goal: a future session can read it to recover what happened, what was decided, and what
is left to do.

## Steps

1. Gather metadata (one Bash call):
   `mkdir -p .sessions && echo "DATE=$(date '+%Y-%m-%d %H:%M')" && echo "SLUG=$(date '+%Y-%m-%d-%H%M')" && git branch --show-current && git log --oneline -20`
2. Pick a short kebab-case topic from `$ARGUMENTS` if provided, else infer it from the session
   (e.g. `architecture-refactor`, `eslint-setup`). The filename is `.sessions/<SLUG>-<topic>.md`.
3. Write the entry with the structure below, filled from THIS conversation (be concrete and honest —
   real decisions, real tradeoffs, real verification results; note what failed or was reverted).
4. Report the saved path. **Do NOT `git add`/`commit`/`push`** — the folder is gitignored on purpose.

## Entry structure

```markdown
---
date: <DATE>
branch: <branch>
topic: <topic>
---

# <Title>

## Goal
One or two sentences: what this session set out to do.

## What was done
Bulleted, concrete. Group by area if large.

## Key decisions & rationale
- **<decision>** — why, and what was rejected. Include tradeoffs and any tooling conflicts
  (e.g. Prettier vs a custom rule) and how they were resolved.

## Gotchas / things that failed
- What broke, what was reverted, what a tool got wrong — so the next session doesn't repeat it.

## Verification
Test/lint/build/visual results at the end of the session (numbers, pass/fail).

## Follow-ups / open items
- Anything deferred, not done, or worth doing next.

## Commits
The session's commits (from `git log --oneline`), newest first.
```

Keep it tight and useful, not a transcript. Aim for signal a future you would actually want.
