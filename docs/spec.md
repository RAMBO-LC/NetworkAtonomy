# Specification — reqanatomy (v1)

This specification defines the complete behavior, boundaries, security invariants, and interface for `reqanatomy` v1.

All claims in this document are marked as **VERIFIED** (with source URL and date), **PROPOSED** (design proposal for v1), or **OPEN** (needs further research or decision).

---

## 1. CLI Usage & Arguments

### Usage Syntax
`reqanatomy <url> [--runs N] [--explain] [--json]` — **PROPOSED**

### Flags & Options
| Flag | Short | Default | Allowed Values | Description | Status |
|------|-------|---------|---------------|-------------|--------|
| `<url>` | — | (required) | Valid http/https URL string | The target URL to probe. | PROPOSED |
| `--runs` | `-n` | 5 | Integer ≥ 1 | Number of probe runs to execute. | PROPOSED |
| `--explain` | `-e` | `false` | Boolean | Appends rule-based diagnosis of the measured stages. | PROPOSED |
| `--json` | `-j` | `false` | Boolean | Emits machine-readable JSON output instead of plain text. | PROPOSED |
| `--max-redirects` | — | 5 | Integer ≥ 0 | Maximum redirect hops followed. | PROPOSED |

### Invalid Input Behavior
- **Missing URL:** Exits with code `1` (Invalid Input) and prints usage instructions. — **PROPOSED**
- **Invalid URL format / unsupported scheme (e.g., `ftp://`, `file://`):** Exits with code `1` and error message `Error: Invalid URL scheme. Only http:// and https:// are supported.`. — **PROPOSED**
- **URL length exceeding 2048 characters:** Exits with code `1` and error message `Error: URL exceeds maximum allowed length of 2048 characters.`. — **PROPOSED**
- **Invalid `--runs` (e.g. 0, negative, non-integer):** Exits with code `1` and error message `Error: --runs must be a positive integer.`. — **PROPOSED**

---

## 2. Exit Codes

| Code | Name | Trigger Condition | Status |
|------|------|------------------|--------|
| `0` | Success | Probe completed successfully (all or majority of runs succeeded). | PROPOSED |
| `1` | Invalid Input | Malformed URL, unsupported scheme, URL length > 2048, or invalid flag arguments. | PROPOSED |
| `2` | Blocked Address (SSRF) | Target IP falls within a blocked IPv4 or IPv6 range. Also used for a redirect whose resolved address is blocked. | PROPOSED |
| `3` | Network Failure | DNS resolution failed (NXDOMAIN), connection refused, host unreachable, or TLS verification failed. | PROPOSED |
| `4` | Timeout | Any stage timed out exceeding configured limits. | PROPOSED |
| `7` | Redirect Loop | A redirect target repeats a URL already visited in this run. | PROPOSED |
| `8` | Too Many Redirects | The number of redirect hops exceeds `--max-redirects`. | PROPOSED |

---

## 3. Stage Definitions & Timing Boundaries

Timers use high-resolution timestamps via Node.js `performance.now()` — **VERIFIED** ([Node.js perf_hooks Docs](https://nodejs.org/api/perf_hooks.html), Checked 2026-11-09).

### Stage Boundaries

#### 1. DNS Resolution (`dns`)
- **Start:** Immediately before invoking `dns.promises.resolve4()` / `resolve6()`.
- **End:** When the promise resolves with IP address records.
- **Node API:** `node:dns/promises` `resolve4` / `resolve6`. — **VERIFIED** ([Node.js DNS Docs](https://nodejs.org/api/dns.html), Checked 2026-11-09).
- **Note:** Bypasses OS local `getaddrinfo` cache when using `dns.resolve*`.

#### 2. TCP Connection (`tcp`)
- **Start:** Immediately before calling `net.connect({ host: checkedIp, port })`.
- **End:** On socket `'connect'` event.
- **Node API:** `node:net` `Socket.connect()`. — **VERIFIED** ([Node.js Net Docs](https://nodejs.org/api/net.html), Checked 2026-11-09).

#### 3. TLS Handshake (`tls`) — HTTPS only
- **Start:** Immediately before wrapping the socket with `tls.connect({ socket, servername: hostname })`.
- **End:** On TLS socket `'secureConnect'` event.
- **Node API:** `node:tls` `TLSSocket` / `tls.connect()`. — **VERIFIED** ([Node.js TLS Docs](https://nodejs.org/api/tls.html), Checked 2026-11-09).
- **HTTP Mode:** Stage duration is `0.00 ms` (or `null` in JSON).

#### 4. Time to First Byte (`ttfb`)
- **Start:** Immediately after writing the complete HTTP GET request headers to the socket.
- **End:** When the first chunk of data arrives on the response stream (socket `'data'` event or HTTP client `'response'` headers event).
- **Node API:** `node:http` / `node:https` `ClientRequest.on('response')`. — **VERIFIED** ([Node.js HTTP Docs](https://nodejs.org/api/http.html), Checked 2026-11-09).

#### 5. Body Download (`body`)
- **Start:** Immediately after the first response byte/header is received (`ttfb` end).
- **End:** When the response stream emits `'end'`.
- **Node API:** Stream `'end'` event. — **VERIFIED** ([Node.js Stream Docs](https://nodejs.org/api/stream.html), Checked 2026-11-09).

---

## 4. Redirect Handling

`reqanatomy` v1 **follows** HTTP redirects, up to the maximum hop count in `docs/parameters.md` (5 by default). — **PROPOSED**

- The timed method is `GET`. — **PROPOSED**
- **Per-hop timing:** Each hop is timed separately (DNS, TCP, TLS, TTFB, body). The result reports per-hop timings and the final page's timings. — **PROPOSED**
- **Per-hop SSRF check:** On every hop, check the scheme (http or https only), resolve the host, reject blocked addresses, and connect to the checked IP. Keep the hostname for SNI and Host. A redirect to a blocked address is an error with exit code `2` (Blocked Address). — **PROPOSED**
- **Relative `Location`:** A relative `Location` header is resolved against the current URL. — **PROPOSED**
- **Loop detection:** A repeated URL (a URL already visited in this run) is a loop error with exit code `7` (Redirect Loop). — **PROPOSED**
- **Hop limit:** Exceeding the maximum hops is an error with exit code `8` (Too Many Redirects). — **PROPOSED**
- **Result reporting:** The reported IP, family, status code, and stage timings are those of the **final** response (the page that returned 2xx/4xx/5xx). Per-hop timings are retained in the JSON output. — **PROPOSED**

---

## 5. Address Handling (IPv4 vs IPv6)

When a hostname resolves to multiple IP addresses:
1. `reqanatomy` resolves both A (IPv4) and AAAA (IPv6) records via `dns.resolve4()` and `dns.resolve6()`. — **PROPOSED**
2. **Filtering:** All resolved addresses are filtered through the SSRF guard. If ANY resolved address is blocked, the target is evaluated per policy (see Section 6).
3. **Selection:** `reqanatomy` picks the first allowed IP address, preferring IPv4 by default for consistent timing benchmarks, while recording the exact IP and address family (`IPv4` or `IPv6`) used. — **PROPOSED**
4. The connected IP is logged in the output report (e.g. `Connected to: 93.184.216.34 (IPv4)`).

---

## 6. SSRF Guard & Anti-DNS Rebinding

### Check Order (Strict Non-Negotiable Pipeline)
1. **URL Parsing:** Extract hostname, port (80 for http, 443 for https unless specified), and scheme.
2. **DNS Resolution:** Resolve hostname to IP addresses using `dns.resolve4()` and `dns.resolve6()`.
3. **IP Range Check:** Verify **every** returned IP address against the blocked subnet list.
   - If **any** IP is in a blocked range → **ABORT** with Exit Code `2` (Blocked Address).
4. **Direct IP Connection:** Open `net.connect()` directly to the validated IP address (`checkedIp`).
5. **SNI & Host Header Preservation:**
   - Pass the original `hostname` as `servername` in `tls.connect({ socket, servername: hostname })`.
   - Set the HTTP `Host:` header to `hostname` (with port if non-standard).

This pipeline runs **on every redirect hop**. There is no option to disable it. — **PROPOSED**

### DNS Rebinding Defense
By connecting to `checkedIp` rather than passing `hostname` to `net.connect()` or `http.request()`, `reqanatomy` guarantees that no second DNS lookup occurs at socket creation time. This immune-by-design structure completely eliminates DNS rebinding vulnerability. — **PROPOSED**

### Blocked Subnets
- **IPv4:** `0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `224.0.0.0/4`, `240.0.0.0/4` — **PROPOSED**
- **IPv6:** `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8` — **PROPOSED**

---

## 7. Runs & Median Calculation

- **Default Runs:** 5 independent runs per execution. — **PROPOSED**
- **Inter-Run Socket Isolation:** Each run opens a new socket. No connection reuse or TLS session tickets between runs. — **PROPOSED**
- **Total definition:** `Total` is the median, across runs, of each run's total from the first DNS lookup to the last body byte of the final response. — **PROPOSED**
- **Median Computation:**
  - For each stage (dns, tcp, tls, ttfb, body) and for the per-run total, extract all successful measurements across runs.
  - Sort values in ascending order.
  - If $N$ is odd, median is the element at index $(N-1)/2$.
  - If $N$ is even, median is the average of elements at $N/2 - 1$ and $N/2$.
  - Calculate `min_ms` and `max_ms` alongside `median_ms`. — **PROPOSED**
- **Partial Run Failures:**
  - If a run fails due to transient network error, it is recorded as failed.
  - If at least 1 run succeeds out of $N$, report medians calculated from successful runs and show warning: `Warning: X of Y runs failed.`.
  - If ALL runs fail, exit with Code `3` (Network Failure) or Code `4` (Timeout). — **PROPOSED**

---

## 8. Output Formats

### Terminal Output (Default)
```
Target: https://example.com (93.184.216.34 - IPv4)
Runs: 5 successful runs

Stage             Median        Min        Max
----------------------------------------------
DNS Lookup       12.40 ms   10.10 ms   15.20 ms
TCP Connect      24.15 ms   22.00 ms   28.50 ms
TLS Handshake    45.30 ms   42.10 ms   51.00 ms
TTFB            110.80 ms  105.20 ms  120.40 ms
Body Download    15.20 ms   12.00 ms   19.10 ms
----------------------------------------------
Total (median of per-run totals) 207.85 ms  191.40 ms  234.20 ms
```

### Waterfall (Terminal)
- Bars use the same values as the table. Scale to the largest stage with a maximum width of 40 characters. Show each stage's percentage of `Total`. On terminals narrower than 60 columns, print only the table. — **PROPOSED**

### Explanations (`--explain`)
When `--explain` is enabled, append rule-based diagnosis beneath the table. Rules and thresholds live in `docs/parameters.md`, each marked PROPOSED. Each message states what the data can and cannot show. The output never names a single bottleneck with certainty. — **PROPOSED**

### JSON Output (`--json`)
JSON Schema — **PROPOSED**:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["url", "ip", "family", "runs_requested", "runs_successful", "stages", "total_median_ms"],
  "properties": {
    "url": { "type": "string" },
    "ip": { "type": "string" },
    "family": { "type": "string", "enum": ["IPv4", "IPv6"] },
    "runs_requested": { "type": "integer" },
    "runs_successful": { "type": "integer" },
    "stages": {
      "type": "object",
      "required": ["dns", "tcp", "tls", "ttfb", "body"],
      "properties": {
        "dns": { "$ref": "#/definitions/StageStats" },
        "tcp": { "$ref": "#/definitions/StageStats" },
        "tls": { "$ref": "#/definitions/StageStats" },
        "ttfb": { "$ref": "#/definitions/StageStats" },
        "body": { "$ref": "#/definitions/StageStats" }
      }
    },
    "total_median_ms": { "type": "number" }
  },
  "definitions": {
    "StageStats": {
      "type": "object",
      "required": ["median_ms", "min_ms", "max_ms"],
      "properties": {
        "median_ms": { "type": "number" },
        "min_ms": { "type": "number" },
        "max_ms": { "type": "number" }
      }
    }
  }
}
```

The JSON output also carries the per-hop timings of the redirect chain (when redirects were followed), the final status code, and any warnings.

---

## 9. SDK (Programmatic API)

- The package entry point exports `probe(url, options)` returning a typed result object with the same numbers as the CLI JSON output. — **PROPOSED**
- `probe()` has no side effects: no printing, no alerts, no process exit. — **PROPOSED**
- Options: `runs`, `timeouts`, and an injected resolver for tests. — **PROPOSED**
- The SDK enforces the same SSRF guard. There is no option to disable it. — **PROPOSED**
- Types are published (exports map and `.d.ts`). — **PROPOSED**
- The package is marked `0.x` and the README states that the API may change before 1.0. — **PROPOSED**

---

## 10. Error Handling & Privacy

- **Error Format:** Standardized user error output to stderr: `Error: <message>`.
- **Sanitization Invariants:**
  - Never print request or response headers containing cookies, authorization tokens, or sensitive values.
  - Never print response body contents.
  - Never output private IP addresses in successful outputs (blocked private IPs trigger immediate SSRF error). — **PROPOSED**

---

## 11. Testing & Guard Injection Strategy

- **SSRF Testing:** The SSRF guard module MUST accept an injectable `resolveDns` dependency function:
  ```ts
  type DnsResolver = (hostname: string) => Promise<{ ipv4: string[]; ipv6: string[] }>;
  ```
  Tests test SSRF blocking by injecting fake DNS resolvers returning `127.0.0.1`, `10.0.0.1`, `::1`, etc., without disabling product guard logic or needing network connectivity. — **PROPOSED**
- **Integration Tests:** Integration test suites spawn local HTTP/HTTPS servers bound to ephemeral ports on `127.0.0.1`. The integration test suite uses the injected resolver to map test target names (e.g. `test.local`) to the local test server port while verifying timing collector mechanics. Product code contains zero bypass flags. — **PROPOSED**

---

## 12. Out of Scope for v1

As listed in `docs/overview.md`:
- HTTP/2 or HTTP/3 multiplex timing.
- Browser rendering, DOM execution, or asset waterfall timing.
- Multi-region probing or remote agent execution.
- Load testing or concurrent request ramping.
- Proxy auto-discovery / environment proxy handling (unless explicitly set via Node).
- Star counts, competitor claims, or any external comparison in the README or any post.
