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

## Open Questions

1. What is the exact tolerance for "stage totals agree with `curl -w`" in the v1 success criteria? — OPEN
2. Should `--timeout` accept a single global timeout or per-stage overrides? Currently spec says per-stage. — OPEN
3. Exact behavior when `--no-verify` is used: does it also affect `rejectUnauthorized` for client certs? — OPEN

## Skills Used

| Skill | Step | Why |
|-------|------|-----|
| (none yet) | — | — |