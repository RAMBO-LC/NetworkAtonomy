# Decisions

Each entry has a status, reason, and rejected option. Never edit old entries to hide a change — add a superseding entry instead.

## D-001: Connect to the checked IP address (SSRF protection)

- **Status:** Accepted
- **Reason:** Connecting by hostname again after DNS resolution allows DNS rebinding attacks. The IP is validated first, then used for the actual connection.
- **Rejected:** Check the hostname, then connect by hostname.

## D-002: Use Node.js built-in `dns`, `net`, `tls`, and `https` modules for timing

- **Status:** Accepted
- **Reason:** No extra dependencies, and exact control over stage boundaries.
- **Rejected:** Third-party timing libraries.

## D-003: v1 does not follow HTTP redirects (3xx)

- **Status:** Superseded by D-R1. See D-R1.
- **Reason:** Timing cross-origin or multi-hop redirects introduces ambiguity into individual stage boundaries. v1 probes the exact target URL only.
- **Rejected:** Auto-follow redirects and time each hop.

## D-004: Address selection prefers IPv4 when both A and AAAA records exist

- **Status:** Accepted
- **Reason:** Consistent timing benchmarks across runs; IPv4 is more widely deployed and avoids Happy Eyeballs variability.
- **Rejected:** Use Node's default Happy Eyeballs algorithm; prefer IPv6.

## D-005: TLS session resumption disabled per run (`sessionTimeout: 0`, fresh socket)

- **Status:** Accepted
- **Reason:** Ensures each run measures a full handshake; prevents resumed sessions from skewing TLS timing.
- **Rejected:** Allow default TLS session caching.

## D-006: Blocked IP ranges — exactly as listed in `docs/parameters.md`

- **Status:** Accepted
- **Reason:** Comprehensive coverage of private, loopback, link-local, unspecified, multicast, and reserved ranges for both IPv4 and IPv6.
- **Rejected:** Smaller subset of ranges; dynamic blocklist.

## D-007: Median of successful runs only; warning if any runs fail; exit non-zero if all fail

- **Status:** Accepted
- **Reason:** Robust against transient network errors while still surfacing persistent failures.
- **Rejected:** Fail the whole probe if any single run fails; or silently drop failed runs without warning.

## D-008: TTFB measured from request write completion to first response byte

- **Status:** Accepted
- **Reason:** The TTFB timer must start after the HTTP request is fully written to the socket (write callback fires), not when write is initiated. Previously started at write initiation, causing ~3x inflation.
- **Fix:** Added `ttfbStartMs` set in `socket.write()` callback; TTFB = `performance.now() - ttfbStartMs` on first `data` event.
- **Verified:** Local fixture with 300ms delay now shows tool TTFB ≈ 302ms (curl: 306ms).

## D-009: Total time = median of per-run totals (not sum of stage medians)

- **Status:** Accepted
- **Reason:** Per-run total = sum of all stage timings for that run. Total median = median of per-run totals across successful runs. This represents actual end-to-end latency distribution. Sum of stage medians is a synthetic value no single run experienced.
- **CLI Output:** Header reads "Total (median of per-run totals)"

## D-010: HTTP status code included in JSON output

- **Status:** Accepted
- **Reason:** Spec requires recording the response status code. Added `statusCode` to `AggregatedResults` from first successful run.
- **Redirect Behavior:** For 3xx responses, the 3xx status code is reported (redirects not followed).

## D-011: Tool does NOT follow HTTP redirects

- **Status:** Superseded by D-R1. See D-R1.
- **Reason:** Spec section "Redirects" states: "The tool MUST NOT follow redirects. The 3xx status code is recorded." Tool measures timing for the initial response only (TTFB and body download for the 3xx response). Location header is parsed but not followed.
- **google.com behavior:** Returns 301 → www.google.com. Tool reports statusCode=301, TTFB≈283ms (for 301 response), body≈0.4ms. Curl follows redirect by default and reports TTFB for final 200 response (~400ms).
- **www.google.com behavior:** Returns 200 OK. Tool reports statusCode=200, TTFB≈317ms, body≈71ms. Matches curl when curl doesn't follow redirects.

## D-R1: Follow redirects, maximum 5 hops

- **Status:** Accepted
- **Reason:** The owner approved following redirects with a hop cap. The value 5 is recorded in [[docs/parameters.md]] as `--max-redirects`.
- **Rejected:** Not following redirects (previous behavior).

## D-R2: Per-hop SSRF check, connect to checked IP, keep hostname for SNI and Host

- **Status:** Accepted
- **Reason:** On every hop, check the scheme (http or https only), resolve the host, reject blocked addresses, and connect to the checked IP. Keep the hostname for SNI and Host. A redirect to a blocked address is an error with exit code 2.
- **Rejected:** Checking only the first hop; connecting by hostname.

## D-R3: Redirect loop and hop-limit errors

- **Status:** Accepted
- **Reason:** A repeated URL is a loop error (exit code 7). Exceeding the maximum hops is an error (exit code 8).
- **Rejected:** Silently stopping; reusing one exit code for both.

## D-R4: Resolve relative Location headers against the current URL

- **Status:** Accepted
- **Reason:** Relative `Location` values must resolve against the URL that produced them.
- **Rejected:** Treating relative locations as absolute; rejecting them.

## D-R5: Timed method is GET

- **Status:** Accepted
- **Reason:** Redirect hops are timed with GET.
- **Rejected:** Preserving the original method across hops.

## D-R6: Per-hop timing, result reports per-hop and final page timings

- **Status:** Accepted
- **Reason:** Each hop is timed separately (DNS, TCP, TLS, TTFB, body). The result reports per-hop timings and the final page's timings.
- **Rejected:** Timing only the first hop; reporting only the final hop.

## D-T1: Total is the median of per-run totals

- **Status:** Accepted
- **Reason:** Total is the median, across runs, of each run's total from the first DNS lookup to the last body byte of the final response. Labeled that way in the output and in [[docs/spec.md]].
- **Rejected:** Sum of stage medians.

## D-W1: Terminal waterfall

- **Status:** Accepted
- **Reason:** Bars use the same values as the table. Scale to the largest stage with a maximum width of 40 characters. Show each stage's percentage of Total. On terminals narrower than 60 columns, print only the table.
- **Rejected:** A separate bar scale; always printing the waterfall.

## D-E1: Explain rules and thresholds in docs/parameters.md

- **Status:** Accepted
- **Reason:** Rules and thresholds live in [[docs/parameters.md]], each marked PROPOSED. Each message states what the data can and cannot show. Never name a single bottleneck with certainty.
- **Rejected:** Hard-coded thresholds in code; naming a single bottleneck.

## D-E2: TLS facts from the Node.js TLS socket

- **Status:** Accepted
- **Reason:** TLS facts come from the Node.js TLS socket. Verified methods `getProtocol()` and `isSessionReused()` in the official Node.js tls documentation for the target version (v26.10.0). Record the URL and date in [[docs/knowledge.md]]. If a method is missing, mark the feature NOT VERIFIED and stop that part. Report the TLS protocol version and whether the session was resumed. Do not state round-trip counts.
- **Rejected:** Guessing protocol support; stating round-trip counts.

## D-E3: Explain output must not claim anything the socket does not expose

- **Status:** Accepted
- **Reason:** The explain output must not claim anything the socket does not expose.
- **Rejected:** Inferring facts beyond the socket's reports.

## D-S1: Export probe(url, options) from the package entry point

- **Status:** Accepted
- **Reason:** Returns a typed result object with the same numbers as the CLI JSON output. No side effects (no printing, no alerts, no process exit). Options: runs, timeouts, and the injected resolver for tests.
- **Rejected:** A separate SDK surface with different numbers.

## D-S2: Publish types, document result shape, mark package 0.x

- **Status:** Accepted
- **Reason:** Publish the types (exports map and `.d.ts`). Document the result shape in [[docs/spec.md]]. Mark the package 0.x in package.json and state in the README that the API may change before 1.0.
- **Rejected:** Shipping untyped API; claiming 1.0 stability.

## D-S3: SDK enforces the same SSRF guard, no option to disable

- **Status:** Accepted
- **Reason:** The SDK must enforce the same SSRF guard. There is no option to disable it.
- **Rejected:** An `allowPrivate` option on the SDK; any bypass flag.

## D-V1: Class-based error hierarchy replacing message-text matching

- **Status:** Accepted
- **Reason:** Error mapping in `mapErrorToExitCode` now uses `instanceof` checks and an `exitCode` property on each error class. This guarantees stable exit codes regardless of error message changes. Every error class maps to exactly one exit code.
- **Rejected:** Message string matching (e.g., `"timeout" in message`) which could mis-map errors like TTFB timeout as `TIMEOUT` instead of `NETWORK_FAILURE`.

## D-V2: SSRF guard verified by mutation test

- **Status:** Accepted
- **Reason:** The blocked-redirect test uses spies on `resolveHostname` and `node:net.connect` to prove no socket is created to `10.0.0.1`. A mutation test (removing the guard call on the redirect path in `runner.ts`) caused the test to hang (real connect to 10.0.0.1), proving the test is valid and the guard is necessary.
- **Rejected:** Assert-only tests without mutation verification.

## D-V3: Partial failures behavior matches spec §7

- **Status:** Accepted
- **Reason:** Current behavior: 4-of-5 successful runs exits 0 with warnings (`Warning: 1 of 5 runs failed`). All 5 runs fail → exits `NETWORK_FAILURE` (3). This matches spec §7: "If at least one run succeeds, exit 0 with a warning listing the failed runs. If all runs fail, exit with the appropriate error code."
- **Rejected:** Changing behavior without spec deviation.

## D-V4: Build and dev scripts added to package.json

- **Status:** Accepted
- **Reason:** `build` compiles TypeScript to `dist/` with existing tsconfig. `dev` runs `src/cli.ts` with `tsx` for direct argument passthrough. Verified `npm run build` succeeds and produces working `dist/cli.js`.
- **Rejected:** No build script (unverifiable distribution); complex build tooling.

## D-UI1: Raw ANSI terminal output for waterfall

- **Status:** Superseded by D-UI1-amended
- **Reason:** Terminal waterfall uses raw ANSI escape sequences for colored bars. No external UI library. Simplicity over features.
- **Rejected:** Using a TUI library like `blessed` or `ink`; building a full widget set.

## D-UI1-amended: Use @profullstack/hqtui, pinned to an exact version (no ^ or ~)

- **Status:** Accepted
- **Reason:** A complete terminal UI layer with a headless renderer and terminal restore, with no transitive runtime dependencies. Supersedes D-UI1 (raw ANSI). Trade-off: depends on a single young maintainer; mitigated by the adapter below.
- **Rejected:** Raw ANSI (D-UI1); `blessed` (previous attempt); `ink` (React dependency).

## D-UI14 Adapter: only src/tui/adapter.ts imports @profullstack/hqtui

- **Status:** Accepted
- **Reason:** All panels and key handling call the adapter's own functions. No other file imports the library. If the library is replaced, only the adapter changes.
- **Rejected:** Importing the library directly in panels or CLI.

## D-UI15 Node version: raise the minimum to Node 22.6 in package.json engines, in docs/spec.md, and in the README

- **Status:** Accepted
- **Reason:** The library's supported runtimes (engines: node >= 22.6).
- **Rejected:** Keeping Node 18/20 minimum.

## D-UI16 Panel mapping: use the widgets in this table, and write any widget the library lacks (the jitter range bar) inside the adapter

- **Status:** Accepted
- **Reason:**
  - Stage bars: meters or progress
  - History: sparkline or graph
  - TLS, certificate, response: keyValues
  - Redirect hops: tree or list
  - Status bar: statusBar
  - Keys: the library's normalized input, mapped to the keys in D-UI5
- **Rejected:** Building custom widgets outside the adapter.

## D-UI17 Tests: render pure panels with renderToText

- **Status:** Accepted
- **Reason:** The unit tests must not need a TTY. Terminal-restore is tested with the library's own behavior plus one integration check on a pseudo-terminal, if one is available in the environment; otherwise mark it NOT VERIFIED.
- **Rejected:** Full integration tests requiring a real terminal.
