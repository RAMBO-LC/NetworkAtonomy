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
- Task 5: DNS timing ([[src/stages/dns.ts]], [[src/stages/__tests__/dns.test.ts]]) — 7 unit tests measuring resolution duration with injected resolver; verified by `npm test`.
- Task 6: TCP timing ([[src/stages/tcp.ts]], [[src/stages/__tests__/tcp.test.ts]]) — 4 unit tests measuring connect duration against local ephemeral server; verified by `npm test`.
- Task 7: TLS timing ([[src/stages/tls.ts]], [[src/stages/__tests__/tls.test.ts]], [[src/fixtures/localhost-cert.pem]]) — 3 unit tests measuring TLS handshake duration (HTTPS > 0, HTTP = 0); verified by `npm test`.
- Task 8: HTTP TTFB & body timing ([[src/stages/http.ts]], [[src/stages/__tests__/http.test.ts]]) — 10 unit tests measuring HTTP TTFB, body download duration, status code parsing, and maxBody capping; verified by `npm test`.
- Task 9: Runs orchestration & median ([[src/runner.ts]], [[src/__tests__/runner.test.ts]]) — 29 unit tests covering sequential/concurrent execution, median/min/max stats, partial failures, injected resolver, IPv4/IPv6, delay between runs; verified by `npm test`.
- Task 10: CLI entry point ([[src/cli.ts]], [[src/__tests__/cli.test.ts]]) — 32 unit tests covering argument parsing, flag validation, explain mode, runProbes integration, JSON/human output, exit codes; verified by `npm test`.