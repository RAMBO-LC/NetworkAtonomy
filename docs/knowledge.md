# Knowledge

> Project memory. No secrets.

## Verified Facts

|| Fact | Source URL | Date Checked ||
|------|-----------|-------------|
| @profullstack/hqtui@0.12.0 runtime dependencies: empty (zero transitive deps) | https://www.npmjs.com/package/@profullstack/hqtui/v/0.12.0 | 2026-11-11 |
| @profullstack/hqtui license: MIT | https://github.com/profullstack/hqtui/blob/main/LICENSE | 2026-11-11 |
| @profullstack/hqtui supports headless rendering via `renderToText` for TTY-free unit tests | https://github.com/profullstack/hqtui/blob/main/README.md | 2026-11-11 |
| @profullstack/hqtui provides terminal restore on Ctrl-C / process exit via `app.stop()` | https://github.com/profullstack/hqtui/blob/main/README.md | 2026-11-11 |
| @profullstack/hqtui minimum Node.js version: >= 22.6 | https://github.com/profullstack/hqtui/blob/main/package.json | 2026-11-11 |
| @profullstack/hqtui widget API: panel, meters, sparkline, keyValues, statusBar, grid layout | https://github.com/profullstack/hqtui/blob/main/README.md | 2026-11-11 |
| Node.js `performance.now()` provides high-resolution timestamps | https://nodejs.org/api/perf_hooks.html | 2026-11-09 |
| `dns.promises.resolve4()` / `resolve6()` bypass OS getaddrinfo cache | https://nodejs.org/api/dns.html | 2026-11-09 |
| `net.connect()` emits `'connect'` on TCP handshake complete | https://nodejs.org/api/net.html | 2026-11-09 |
| `tls.connect()` emits `'secureConnect'` on TLS handshake complete | https://nodejs.org/api/tls.html | 2026-11-09 |
| `http.ClientRequest.on('response')` fires when headers received | https://nodejs.org/api/http.html | 2026-11-09 |
| Stream `'end'` event fires when body fully received | https://nodejs.org/api/stream.html | 2026-11-09 |
| WHATWG `URL` constructor lowercases scheme, parses host/port; length-first validation avoids parse-side effects | https://url.spec.whatwg.org/ | 2026-11-09 |
| IPv4/IPv6 CIDR range matching via bitwise operations correctly identifies all blocked ranges per RFC 1918, RFC 4193, RFC 3927, RFC 5735 | https://datatracker.ietf.org/doc/html/rfc1918, https://datatracker.ietf.org/doc/html/rfc4193, https://datatracker.ietf.org/doc/html/rfc3927 | 2026-11-09 |
| DNS rebinding: attacker changes DNS after check to point to private IP; guard resolves, checks all addresses, connects only to checked address | https://owasp.org/www-community/attacks/DNS_Rebinding | 2026-11-09 |
| IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) must be normalized to IPv4 before guard check | https://datatracker.ietf.org/doc/html/rfc4291 | 2026-11-09 |
| DNS timing: `performance.now()` before `resolver()`, stop after all addresses returned, injectable resolver for testability | https://nodejs.org/api/perf_hooks.html | 2026-11-09 |
| TCP timing: `performance.now()` before `net.connect()`, stop on `'connect'` event; socket returned for TLS wrap | https://nodejs.org/api/net.html | 2026-11-09 |
| TLS timing: `performance.now()` before `tls.connect({ socket, servername })`, stop on `'secureConnect'`; HTTP returns 0 | https://nodejs.org/api/tls.html | 2026-11-09 |
| HTTP timing: `performance.now()` TTFB from request write to first response byte; body from first byte to stream 'end'; maxBody cap stops reading | https://nodejs.org/api/http.html | 2026-11-09 |
| Median calculation: sorted array, odd count = middle, even count = average of two middle values | https://en.wikipedia.org/wiki/Median | 2026-11-09 |
| CLI argument parsing: positional URL + flags (--runs, --concurrency, --delay, --max-body, --insecure, --timeout, --json, --explain, --help) | https://nodejs.org/api/process.html | 2026-11-09 |
| JSON Schema validation: structural typing with $defs for reusable stageStats, enum for family, non-negative number constraints | https://json-schema.org/ | 2026-11-09 |
| --explain dry-run: pre-resolves IP via DNS, lists stages (DNS/TCP/TLS/TTFB/Body), calculates estimated time from runs/concurrency/delay/timeouts | https://nodejs.org/api/process.html | 2026-11-09 |
| Exit codes: OK=0, INVALID_ARGS=1, DNS_FAILED=2, TCP_FAILED=3, TLS_FAILED=4, HTTP_FAILED=5, ALL_RUNS_FAILED=6, INTERNAL_ERROR=255; typed error hierarchy; stderr for errors, stdout for results | https://nodejs.org/api/process.html | 2026-11-09 |
| `npm ci` installs from lockfile; `vitest run` executes tests with globals; `tsc --noEmit` typechecks without emit | https://docs.npmjs.com/cli/v10/commands/npm-ci, https://vitest.dev/config/, https://www.typescriptlang.org/docs/handbook/compiler-options.html | 2026-11-09 |
| Integration tests: local ephemeral HTTP/HTTPS servers (no external network), mock DNS resolver to return 127.0.0.1, tests flag combos (--runs, --concurrency, --delay, --max-body, --timeout, --json, --insecure), validates human-readable & JSON output, timing plausibility, schema compliance, error handling | vitest docs + local server patterns | 2026-11-10 |
| TTFB timing boundary: start = after request fully written (socket.write() callback fires), end = first response byte (socket 'data' event) | https://nodejs.org/api/net.html#socketwritechunk-encoding-callback | 2026-11-10 |
| TTFB bug fixed: was measuring from write initiation (~1015ms), now from write completion (~302ms for 300ms server delay) | Local fixture test + curl comparison | 2026-11-10 |
| curl `time_starttransfer` matches tool TTFB when both measure from write completion (curl: 306ms, tool: 302ms for 300ms server delay) | curl docs: https://curl.se/docs/manpage.html#-w | 2026-11-10 |
| Total time = median of per-run totals (not sum of stage medians); per-run total = sum of all stage timings for that run | runner.ts:195, 312, 320 | 2026-11-10 |
| Redirect handling: tool does NOT follow 3xx; reports 3xx statusCode, measures TTFB/body of redirect response only | http.ts statusLine parsing; spec.md Redirects section | 2026-11-10 |
| google.com returns 301 redirect to www.google.com; tool measures TTFB of 301 response (283ms median); curl follows redirect and reports TTFB of final 200 response (~400ms) | Manual tool run (5 runs) + curl -w (5 runs) | 2026-11-10 |
| www.google.com returns 200 OK; tool TTFB 317ms median, body 71ms median; curl TTFB 333-623ms, total 382-681ms | Manual tool run (5 runs) + curl -w (5 runs) | 2026-11-10 |
| Probe creates fresh TCP/TLS connection per run; DNS resolved ONCE and IP reused across runs (SSRF protection); no socket reuse | runner.ts:293 (resolveHostname once), 172 (measureTcp per run), 176 (measureTls per run) | 2026-11-10 |
| Original TTFB spread (442-1873ms) was caused by bug measuring from write initiation; fixed spread (258-288ms) reflects actual network variance | Bug investigation fixture tests | 2026-11-10 |
| TLS protocol version: `tls.TLSSocket.getProtocol()` returns the negotiated protocol string (e.g. "TLSv1.3"), or `null` when the handshake is incomplete | https://nodejs.org/api/tls.html#tlssocketgetprotocol | 2026-11-10 |
| TLS session resumption: `tls.TLSSocket.isSessionReused()` returns a boolean indicating whether the session was resumed | https://nodejs.org/api/tls.html#tlssocketissessionreused | 2026-11-10 |
| Node.js target version for the TLS facts above: v26.10.0 | https://nodejs.org/api/tls.html | 2026-11-10 |
| SSRF guard runs on every redirect hop; there is no option to disable it (SDK or CLI) | src/net/resolve.ts, src/runner.ts, docs/decisions.md D-S3 | 2026-11-10 |

## Open Questions

1. What is the exact tolerance for "stage totals agree with `curl -w`" in the v1 success criteria? — OPEN
2. Should `--timeout` accept a single global timeout or per-stage overrides? Currently spec says per-stage. — OPEN
3. Exact behavior when `--no-verify` is used: does it also affect `rejectUnauthorized` for client certs? — OPEN

## Skills Used

| Skill | Step | Why |
|-------|------|-----|
| opencode-delegation | Task 1 | Scaffold creation via OpenCode |