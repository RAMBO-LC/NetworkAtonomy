# Report & Review Workflow

Ten numbered rules for every report:

1. **Label every claim with an evidence label.** Never write "fixed" without a test name.
2. **Reproduce before fixing:** a failing automated test first, then the fix, then the passing test.
3. **Show exact commands and summary output.** Do not paraphrase test output.
4. **Give one diagnostic command** instead of manual steps. Ask for its output.
5. **Ask at most three questions.**
6. **Update docs/status.md, docs/decisions.md** (for design or dependency choices), **and CHANGELOG.md** (for behavior changes).
7. **Stay on the current task.** Say when a request belongs to a later phase.
8. **List what you could not confirm** under "Not verified", with the reason.
9. **Never change tests to match code.**
10. **Check the symptom path in order:** Node 20 or newer, `npm ci` succeeds, the CLI runs, the failing stage prints valid JSON with `--json`, the relevant test file runs.

## Report Template

```
Task:
Branch:
Changes:
Evidence:
  - [label] [description] [command + summary output]
Records updated:
Next step:
Questions:
```