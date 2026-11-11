---
name: 
description: Delegate code changes to OpenCode in the project folder, then verify its work with tests and the git diff. Use for any task that edits code.
---

# Delegating to OpenCode

## Rules
1. Hermes plans and verifies. OpenCode writes the code.
2. One task per run. Every run gets a brief with: goal, files allowed to change, acceptance command, and things not to touch.
3. Work on a branch: `git switch -c task/<name>`. Never edit main.
4. Never change tests to make them pass. Test changes need their own task with a stated reason.
5. After each run, run the acceptance command yourself, read `git diff`, and confirm changes stay inside the allowed files.
6. If a check fails, start a new run with the failing output included. After 3 failed runs, stop and report to the user.

## Run command
cd <project-folder> && opencode run "<brief>"
Check the current flags with `opencode run --help` before first use.

## Brief template
Goal: <one sentence>
Allowed files: <list>
Do not touch: <list>
Acceptance: run `<test command>` and it must pass.
When done: summarize what changed and why.