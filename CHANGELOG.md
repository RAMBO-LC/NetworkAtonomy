# Changelog

## [Unreleased]

### Added

- Agent rules ([[AGENT.md]], [[.agent/workflows/report-review.md]]).
- Project records ([[docs/status.md]], [[docs/decisions.md]], [[docs/knowledge.md]]).
- Project documentation ([[docs/overview.md]], [[docs/challenges.md]], [[docs/parameters.md]], [[docs/planning.md]]).
- Full specification ([[docs/spec.md]]) covering CLI, exit codes, stage boundaries, redirects, address handling, SSRF guard, runs/median, output formats, error handling, testing strategy, and out-of-scope items.
- Phase 2 task plan ([[docs/plan.md]]) with 15 tasks, each with allowed files, acceptance command, dependencies, and evidence requirements.
- Task 1: project scaffold ([[package.json]], [[tsconfig.json]], [[vitest.config.ts]], [[src/__tests__/placeholder.test.ts]]) — verified by `npm test`.