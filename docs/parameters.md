# Parameters

## CLI Flags

| Flag | Default | Allowed Values | Why | Status |
|------|---------|---------------|-----|--------|
| `--runs` | 5 | integer ≥ 1 | Median of N runs filters noise. 5 is the minimum for a meaningful median. | PROPOSED |
| `--explain` | off | boolean | Rule-based diagnosis of the measured stages. | PROPOSED |
| `--json` | off | boolean | Machine-readable output with documented field names. | PROPOSED |
| `--timeout <stage> <ms>` | see below | integer | Per-stage override for DNS, TCP, TLS, ttfb, body. | PROPOSED |
| `--delay <ms>` | 0 | integer ≥ 0 | Delay between runs; politeness. | PROPOSED |
| `--max-redirects` | 5 | integer ≥ 0 | Cap on redirect hops followed. | PROPOSED |
| `--max-body <bytes>` | 1048576 | integer ≥ 0 | Stop reading after this many body bytes. | PROPOSED |
| `--no-verify` | off | boolean | Skip TLS certificate verification. | PROPOSED |

## Per-Stage Timeouts

| Stage | Default (ms) | Why | Status |
|-------|-------------|-----|--------|
| DNS | 5000 | Typical resolver timeout; avoids hanging on dead names. | PROPOSED |
| TCP connect | 5000 | Standard connect timeout. | PROPOSED |
| TLS handshake | 10000 | Handshakes can be slower; gives room. | PROPOSED |
| TTFB | 15000 | First-byte wait can be long on slow servers. | PROPOSED |
| Body download | 30000 | Total body read cap; adjusts with `--max-body`. | PROPOSED |

## Input Limits

| Parameter | Value | Why | Status |
|-----------|-------|-----|--------|
| URL length | 2048 chars | Conservative ceiling; RFC 9110 recommends 8000 octets but practical limits are lower. | PROPOSED |
| Allowed schemes | `http`, `https` only | Prevents non-HTTP protocols and file:// access. | PROPOSED |
| Max redirects | 5 | Prevents redirect loops. | PROPOSED |
| Max body bytes | 1 MB (1048576) | Bounds memory use. | PROPOSED |

## Network Settings

| Parameter | Default | Why | Status |
|-----------|---------|-----|--------|
| Address family | `verbatim` (Node default) | Keeps resolver order; report which family was used. | PROPOSED |
| System proxies | Not used by default | `NODE_USE_ENV_PROXY` must be set; document that timings include proxy overhead. | PROPOSED |
| User agent | `reqanatomy/v1` | Identifies the tool. | PROPOSED |
| Timed method | GET | Redirect hops are timed with GET. | PROPOSED |

## Safety Settings

| Parameter | Default | Why | Status |
|-----------|---------|-----|--------|
| Blocked IPv4 ranges | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `0.0.0.0/8`, `224.0.0.0/4`, `240.0.0.0/4` | Private, loopback, link-local, unspecified, multicast, reserved. | PROPOSED |
| Blocked IPv6 ranges | `::1/128`, `fe80::/10`, `fc00::/7`, `::/128`, `ff00::/8` | Loopback, link-local, unique-local, unspecified, multicast. | PROPOSED |
| Certificate verification | `rejectUnauthorized: true` | Default secure; `--noverify` to override. | PROPOSED |
| SSRF guard | Always on, every hop | No option to disable. | PROPOSED |

## Output Settings

| Parameter | Default | Why | Status |
|-----------|---------|-----|--------|
| Format | Plain text | Human-readable by default. | PROPOSED |
| `--json` field names | `stage`, `median_ms`, `min_ms`, `max_ms`, `runs`, `url`, `ip`, `family` | Documented in the spec. | PROPOSED |
| Rounding | 2 decimal places | Millisecond precision is sufficient; sub-ms is noise. | PROPOSED |
| Waterfall max width | 40 characters | Scales to the largest stage. | PROPOSED |
| Waterfall narrow terminal | Table only | Below 60 columns, print only the table. | PROPOSED |

## Explain Rules

Each rule fires on its condition. Every message states what the data can and cannot show, and never names a single bottleneck with certainty.

| Rule | Condition | Message | Status |
|------|-----------|---------|--------|
| TTFB is high | `ttfb.medianMs` ≥ 300 | "TTFB is high. It includes network round trips, server processing, and any proxy or CDN on the path." | PROPOSED |
| TLS is high | `tls.medianMs` ≥ 200 and scheme is https | "TLS handshake is high. It includes certificate verification and key exchange." | PROPOSED |
| DNS is high | `dns.medianMs` ≥ 100 | "DNS lookup is high. It can include resolver cache misses and multiple record lookups." | PROPOSED |
| Body is high | `body.medianMs` ≥ 200 | "Body download is high. It depends on payload size and network throughput." | PROPOSED |
| TCP is high | `tcp.medianMs` ≥ 100 | "TCP connect is high. It includes the network round trips of the three-way handshake." | PROPOSED |
| TLS protocol reported | Socket reports a protocol | "TLS protocol: <version>. The socket reports the negotiated protocol." | PROPOSED |
| TLS session resumed | Socket reports a resumed session | "TLS session was resumed. The socket reports session resumption." | PROPOSED |

## Environment Variables

| Variable | Why | Status |
|----------|-----|--------|
| `HTTP_PROXY` / `HTTPS_PROXY` | Proxy configuration; only used if `NODE_USE_ENV_PROXY=1`. | PROPOSED |
| `NO_PROXY` | Hosts to bypass the proxy. | PROPOSED |
| `NODE_USE_ENV_PROXY` | Enable env-based proxy support. | PROPOSED |
