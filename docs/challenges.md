# Challenges

| # | Challenge | Why It Matters | Plan | Status |
|---|-----------|---------------|------|--------|
| 1 | DNS caching | The OS resolver cache can make DNS timing look faster than the real lookup. | Use `dns.resolve4()` with `{ ttl: true }` for fresh lookups; report TTL. | PROPOSED |
| 2 | Connection reuse and keep-alive | A second request may skip DNS, TCP, and TLS entirely. | Always create a fresh socket per run; no keep-alive between runs. | PROPOSED |
| 3 | TLS session resumption | A resumed handshake is shorter than a full one. | Disable session resumption (`sessionTimeout: 0`) for consistent timing. | PROPOSED |
| 4 | HTTP/2 and HTTP/3 | Multiplexing and QUIC change which stages exist and where they start. | v1: HTTP/1.1 only. HTTP/2 deferred (see `docs/planning.md`). HTTP/3 not supported in Node without `--experimental-quic`. | VERIFIED — [node:http2](https://nodejs.org/api/http2.html) stable since v10; [node:quic](https://nodejs.org/api/quic.html) still experimental. |
| 5 | IPv4 vs IPv6 and address selection | Which address gets used changes timing. | Default to `verbatim` ordering (Node default); report which family was used. | PROPOSED |
| 6 | CDNs and anycast | Same hostname gives different results from different networks. | One probe location; document that results vary. | PROPOSED |
| 7 | Network variance | Jitter, congestion, and one-off spikes. | Median of N runs (default 5); report min/max alongside median. | PROPOSED |
| 8 | Redirects | Whether to time each hop or only the final URL. | Follow redirects; time only the final URL's stages. Max 5 redirects. | PROPOSED |
| 9 | System proxies (HTTP_PROXY, HTTPS_PROXY) | They change the network path. | Node supports env proxies via `NODE_USE_ENV_PROXY`; document that timings include proxy overhead. | VERIFIED — [Node proxy docs](https://nodejs.org/learn/http/enterprise-network-configuration). |
| 10 | SSRF and DNS rebinding | The attack, and the connect-to-checked-IP rule. | Validate IP against blocked ranges; connect to the IP, not the hostname. Keep hostname for SNI and Host header. | PROPOSED |
| 11 | Large or compressed responses | Memory use, decompression time, and whether download time includes decoding. | Read up to a max body size (default 1 MB); stop and report truncation. Time includes download only, not decompression. | PROPOSED |
| 12 | Timer precision in Node.js | `process.hrtime.bigint()` gives nanosecond resolution; event loop jitter adds noise. | Use `performance.now()` for stage boundaries; median filters noise. | VERIFIED — [Node perf_hooks](https://nodejs.org/api/perf_hooks.html). |
| 13 | Certificate errors and TLS settings | What happens when the handshake fails; whether to verify by default. | `rejectUnauthorized: true` by default; report TLS errors distinctly from network errors. | PROPOSED |
| 14 | Politeness toward target sites | Rate limits and the load the probe creates. | Default `--runs 5`; add `--delay` between runs (default 0); document recommended delays. | PROPOSED |
| 15 | Scope drift | Agents adding features outside the spec. | AGENT.md + allowed-files rule in `docs/plan.md`. | PROPOSED |
| 16 | Model and tool limits | Free-tier rate limits, failover, inconsistent output from auto routing. | Use OpenCode with explicit model pinning; verify diffs after every run. | OPEN |
| 17 | macOS environment | GUI apps may not inherit the shell PATH, so `opencode` or `node` may not be found. | Use absolute paths or `which -a` to resolve binaries. | VERIFIED — observed in this environment. |
