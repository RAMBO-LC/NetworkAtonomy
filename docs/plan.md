# Phase 2 Task Plan

Each task is small enough for one OpenCode run. Every task must pass its acceptance test before it is reported as done.

---

## Task 1 — Project Scaffold
- **Goal:** Create `package.json`, TypeScript config, Vitest setup, and one passing placeholder test.
- **Allowed files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/__tests__/placeholder.test.ts`
- **Do-not-touch:** Any existing source files (none yet).
- **Acceptance command:** `npm ci && npm test`
- **Dependencies:** None.
- **Evidence:** `VERIFIED BY TEST: npm test` (exit code 0, at least 1 test passes).
- **Status:** NOT STARTED

---

## Task 2 — URL Validation
- **Goal:** Implement scheme check (`http`/`https` only) and URL length limit (2048 chars). Pure functions with unit tests.
- **Allowed files:** `src/url/validate.ts`, `src/url/__tests__/validate.test.ts`
- **Do-not-touch:** Scaffold config files from Task 1.
- **Acceptance command:** `npm test -- src/url/__tests__/validate.test.ts`
- **Dependencies:** Task 1.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/url/__tests__/validate.test.ts` (all tests pass).
- **Status:** NOT STARTED

---

## Task 3 — Address Classification
- **Goal:** Pure functions that classify IPv4 and IPv6 addresses as blocked or allowed. Unit tests covering every blocked range from `docs/parameters.md`.
- **Allowed files:** `src/net/address.ts`, `src/net/__tests__/address.test.ts`
- **Do-not-touch:** URL validation, scaffold.
- **Acceptance command:** `npm test -- src/net/__tests__/address.test.ts`
- **Dependencies:** Task 1.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/net/__tests__/address.test.ts` (all blocked ranges covered and rejected).
- **Status:** NOT STARTED

---

## Task 4 — Resolver & Guard
- **Goal:** Implement `resolveHostname(hostname: string)` that resolves A/AAAA, checks all IPs against guard, returns one checked IP + family. Resolver must be injectable for tests.
- **Allowed files:** `src/net/resolve.ts`, `src/net/__tests__/resolve.test.ts`
- **Do-not-touch:** Address classification, URL validation, scaffold.
- **Acceptance command:** `npm test -- src/net/__tests__/resolve.test.ts`
- **Dependencies:** Task 3.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/net/__tests__/resolve.test.ts` (injected fake resolver tests SSRF blocking).
- **Status:** NOT STARTED

---

## Task 5 — DNS Timing
- **Goal:** Measure DNS resolution time using `dns.promises.resolve4()` / `resolve6()`. Returns duration in ms.
- **Allowed files:** `src/stages/dns.ts`, `src/stages/__tests__/dns.test.ts`
- **Do-not-touch:** Resolver, guard, address, validation.
- **Acceptance command:** `npm test -- src/stages/__tests__/dns.test.ts`
- **Dependencies:** Task 4.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/stages/__tests__/dns.test.ts` (timing function returns positive ms).
- **Status:** NOT STARTED

---

## Task 6 — TCP Timing
- **Goal:** Open TCP connection to `checkedIp:port` using `net.connect()`, measure time to `'connect'` event. Clean socket close.
- **Allowed files:** `src/stages/tcp.ts`, `src/stages/__tests__/tcp.test.ts`
- **Do-not-touch:** DNS stage, resolver, guard.
- **Acceptance command:** `npm test -- src/stages/__tests__/tcp.test.ts`
- **Dependencies:** Task 4.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/stages/__tests__/tcp.test.ts` (connects to local test server, returns ms).
- **Status:** NOT STARTED

---

## Task 7 — TLS Timing
- **Goal:** Wrap TCP socket with `tls.connect({ socket, servername: hostname })`, measure time to `'secureConnect'`. HTTP: return 0 ms.
- **Allowed files:** `src/stages/tls.ts`, `src/stages/__tests__/tls.test.ts`
- **Do-not-touch:** TCP, DNS, resolver, guard.
- **Acceptance command:** `npm test -- src/stages/__tests__/tls.test.ts`
- **Dependencies:** Task 6.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/stages/__tests__/tls.test.ts` (HTTPS returns ms > 0; HTTP returns 0).
- **Status:** NOT STARTED

---

## Task 8 — HTTP TTFB & Body Timing
- **Goal:** Write HTTP GET request, measure TTFB (first response byte/headers), measure body download to stream `'end'`. Respect `--max-body` cap.
- **Allowed files:** `src/stages/http.ts`, `src/stages/__tests__/http.test.ts`
- **Do-not-touch:** TLS, TCP, DNS, resolver, guard.
- **Acceptance command:** `npm test -- src/stages/__tests__/http.test.ts`
- **Dependencies:** Task 7.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/stages/__tests__/http.test.ts` (TTFB and body ms captured against local fixture server).
- **Status:** NOT STARTED

---

## Task 9 — Runs & Median Calculation
- **Goal:** Orchestrate N independent runs (no socket reuse, no TLS session tickets). Compute median, min, max per stage. Handle partial failures.
- **Allowed files:** `src/core/runner.ts`, `src/core/__tests__/runner.test.ts`
- **Do-not-touch:** All stage modules, resolver, guard.
- **Acceptance command:** `npm test -- src/core/__tests__/runner.test.ts`
- **Dependencies:** Tasks 5, 6, 7, 8.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/core/__tests__/runner.test.ts` (unit tests with fixed arrays verify median/min/max logic).
- **Status:** NOT STARTED

---

## Task 10 — Terminal Output
- **Goal:** Format terminal table with Stage, Median, Min, Max columns. Show URL, IP, family, runs count. Round to 2 decimals.
- **Allowed files:** `src/output/terminal.ts`, `src/output/__tests__/terminal.test.ts`
- **Do-not-touch:** Runner, stages, resolver, guard.
- **Acceptance command:** `npm test -- src/output/__tests__/terminal.test.ts`
- **Dependencies:** Task 9.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/output/__tests__/terminal.test.ts` (output matches expected format).
- **Status:** NOT STARTED

---

## Task 11 — JSON Output & Schema
- **Goal:** Emit JSON matching the schema in `docs/spec.md` Section 8. Include schema validation test.
- **Allowed files:** `src/output/json.ts`, `src/output/__tests__/json.test.ts`
- **Do-not-touch:** Terminal output, runner, stages, resolver, guard.
- **Acceptance command:** `npm test -- src/output/__tests__/json.test.ts`
- **Dependencies:** Task 9.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/output/__tests__/json.test.ts` (output validates against embedded schema).
- **Status:** NOT STARTED

---

## Task 12 — `--explain` Output
- **Goal:** When `--explain` flag is set, append explanatory text for each stage beneath the table.
- **Allowed files:** `src/output/explain.ts`, `src/output/__tests__/explain.test.ts`, `src/cli/flags.ts`
- **Do-not-touch:** Terminal/JSON output core, runner, stages.
- **Acceptance command:** `npm test -- src/output/__tests__/explain.test.ts`
- **Dependencies:** Task 10.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/output/__tests__/explain.test.ts` (explanatory strings present in output).
- **Status:** NOT STARTED

---

## Task 13 — Exit Codes & Error Messages
- **Goal:** Implement all exit codes (0, 1, 2, 3, 4) with standardized stderr messages. One test per exit code.
- **Allowed files:** `src/cli/errors.ts`, `src/cli/__tests__/errors.test.ts`
- **Do-not-touch:** Output modules, runner, stages, resolver, guard.
- **Acceptance command:** `npm test -- src/cli/__tests__/errors.test.ts`
- **Dependencies:** Tasks 2, 4, 9.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/cli/__tests__/errors.test.ts` (each exit code triggered and verified).
- **Status:** NOT STARTED

---

## Task 14 — Integration Test (Local Fixture Server)
- **Goal:** Spin up a local HTTP/HTTPS test server on ephemeral port. Run full probe via injected resolver mapping. Guard MUST be injected/stubbed, not disabled in product code.
- **Allowed files:** `src/__tests__/integration.test.ts`, `src/__tests__/fixture-server.ts`
- **Do-not-touch:** All product code.
- **Acceptance command:** `npm test -- src/__tests__/integration.test.ts`
- **Dependencies:** Tasks 1–13.
- **Evidence:** `VERIFIED BY TEST: npm test -- src/__tests__/integration.test.ts` (full end-to-end probe completes with timings).
- **Status:** NOT STARTED

---

## Task 15 — README Update with Measured Limits
- **Goal:** Update `README.md` with actual measured limits, usage examples, and documented exit codes.
- **Allowed files:** `README.md`
- **Do-not-touch:** All product code.
- **Acceptance command:** `cat README.md` (manual review)
- **Dependencies:** Task 14.
- **Evidence:** `IMPLEMENTED: README.md updated with measured limits and examples.`
- **Status:** NOT STARTED