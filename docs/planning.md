# Planning

## Approach

Build `reqanatomy` incrementally, one task at a time, each on its own branch. Every task must pass its acceptance test before it is reported as done. Documentation and records are updated in the same commit as code.

## Phases

| Phase | Goal | Exit Condition | Complete |
|-------|------|---------------|----------|
| 1 | Planning and research | User approves [[docs/spec.md]] and [[docs/plan.md]] | No |
| 2 | Build v1, one task at a time | All tasks in [[docs/plan.md]] done and accepted | No |
| 3 | Accuracy study against `curl -w` and DevTools | Method written down; results published | No |
| 4 | Publish the CLI, the study, and the write-up | CLI released; study posted | No |

## Decision Gates

1. **Phase 1 → 2:** User approves [[docs/spec.md]] and [[docs/plan.md]].
2. **Phase 2 → 3:** User approves v1 feature complete.
3. **Phase 3 → 4:** User approves accuracy study results.
4. **Any phase → publish:** User explicitly asks.

## Milestones

| Milestone | Date |
|-----------|------|
| Spec and plan approved | (blank) |
| v1 scaffold done | (blank) |
| v1 feature complete | (blank) |
| Accuracy study done | (blank) |
| Published | (blank) |

## Deferred Work (v2+)

| Idea | Reason Deferred |
|------|----------------|
| Multiple probe regions | Needs infrastructure; v1 is single-location. |
| Render time measurement | Needs a headless browser; out of scope for v1. |
| Web view / dashboard | Not a v1 goal; CLI only. |
| HTTP/2 support | Deferred until v1 is stable and tested. |
| HTTP/3 support | Node `node:quic` is still experimental. |

## Related Docs

- [[docs/overview.md]] — the idea.
- [[docs/challenges.md]] — risks and open questions.
- [[docs/parameters.md]] — settings reference.
- [[docs/spec.md]] — full specification (Phase 2).
- [[docs/plan.md]] — task plan (Phase 2).
