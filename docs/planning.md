# Planning

## Approach

Build `reqanatomy` incrementally, one task at a time, each on its own branch. Every task must pass its acceptance test before it is reported as done. Documentation and records are updated in the same commit as code.

## Phases

| Phase | Goal | Exit Condition | Complete |
|-------|------|---------------|----------|
| 1 | Planning and research | User approves [[docs/spec.md]] and [[docs/plan.md]] | Yes |
| 2 | Build v1, one task at a time | All tasks in [[docs/plan.md]] done and accepted | Yes |
| 2b | v1 full feature pass | Redirects, waterfall, explain, SDK, published types | No |
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
| Spec and plan approved | 2026-11-09 |
| v1 scaffold done | 2026-11-10 |
| v1 feature complete | (blank) |
| Accuracy study done | (blank) |
| Published | (blank) |

## v1 Full Feature Pass

Branch `task/v1-full-feature` from `build/v1`. Features, all owner-approved:

1. Redirects (D-R1…D-R6): follow up to 5 hops, per-hop SSRF check and per-hop timing, loop and hop-limit errors.
2. Total as median of per-run totals (D-T1).
3. Terminal waterfall (D-W1): same values as table, max width 40, percentage of Total, table only under 60 columns.
4. Rule-based explain (D-E1…D-E3): rules and thresholds in [[docs/parameters.md]], can/cannot wording, TLS facts from the socket.
5. SDK `probe()` (D-S1…D-S3): typed result, no side effects, same numbers as CLI JSON, same SSRF guard, published types, `0.x` package.

Not in this pass: star counts, competitor claims, external comparison, multi-region probes, render time, accounts, monitoring, web UI.

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
