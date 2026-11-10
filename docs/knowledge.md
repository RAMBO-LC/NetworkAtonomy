# Knowledge

> Project memory. No secrets.

## Verified Facts

| Fact | Source URL | Date Checked |
|------|-----------|-------------|
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
| `npm ci` installs from lockfile; `vitest run` executes tests with globals; `tsc --noEmit` typechecks without emit | https://docs.npmjs.com/cli/v10/commands/npm-ci, https://vitest.dev/config/, https://www.typescriptlang.org/docs/handbook/compiler-options.html | 2026-11-09 |

## Open Questions

1. What is the exact tolerance for "stage totals agree with `curl -w`" in the v1 success criteria? — OPEN
2. Should `--timeout` accept a single global timeout or per-stage overrides? Currently spec says per-stage. — OPEN
3. Exact behavior when `--no-verify` is used: does it also affect `rejectUnauthorized` for client certs? — OPEN

## Skills Used

| Skill | Step | Why |
|-------|------|-----|
| opencode-delegation | Task 1 | Scaffold creation via OpenCode |