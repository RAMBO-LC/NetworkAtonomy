# Changelog

## [Unreleased]

### Added

- Agent rules ([[AGENT.md]], [[.agent/workflows/report-review.md]]).
- Project records ([[docs/status.md]], [[docs/decisions.md]], [[docs/knowledge.md]]).
- Project documentation ([[docs/overview.md]], [[docs/challenges.md]], [[docs/parameters.md]], [[docs/planning.md]]).
- Full specification ([[docs/spec.md]]) covering CLI, exit codes, stage boundaries, redirects, address handling, SSRF guard, runs/median, output formats, error handling, testing strategy, and out-of-scope items.
- Phase 2 task plan ([[docs/plan.md]]) with 15 tasks, each with allowed files, acceptance command, dependencies, and evidence requirements.
- Task 1: project scaffold ([[package.json]], [[tsconfig.json]], [[vitest.config.ts]], [[src/__tests__/placeholder.test.ts]]) — verified by `npm test`.
- Task 2: URL validation ([[src/url/validate.ts]], [[src/url/__tests__/validate.test.ts]]) — 30 unit tests covering scheme, length, parseability, purity; verified by `npm test`.
- Task 3: address classification ([[src/net/address.ts]], [[src/net/__tests__/address.test.ts]]) — 21 unit tests covering all 8 IPv4 and 5 IPv6 blocked ranges per RFC 1918/4193/3927; verified by `npm test`.
- Task 4: resolver & guard ([[src/net/resolve.ts]], [[src/net/__tests__/resolve.test.ts]]) — 29 unit tests covering IPv4/IPv6 resolution, IPv4-mapped IPv6 blocking, resolver injection; verified by `npm test`.