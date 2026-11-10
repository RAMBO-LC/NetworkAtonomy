# Network Atonomy

A CLI tool that measures network timing stages (DNS, TCP, TLS, TTFB, Body Download) for a given URL and reports the median of N runs.

## Installation

```bash
npm install -g networkatonomy
# or
npx networkatonomy <URL>
```

## Quick Start

```bash
# Basic usage (5 runs, sequential)
npx networkatonomy https://example.com

# 10 runs with 2 concurrent
npx networkatonomy https://example.com --runs 10 --concurrency 2

# JSON output with 5 second timeout
npx networkatonomy https://example.com --timeout 5000 --json

# Dry-run: show what would be executed without running probes
npx networkatonomy https://example.com --explain

# Test against local server (bypass SSRF guard)
npx networkatonomy http://127.0.0.1:8080 --allow-private
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `<URL>` | Target URL (required) | — |
| `--runs <n>` | Number of probe runs | `5` |
| `--concurrency <n>` | Maximum concurrent runs | `1` |
| `--delay <ms>` | Delay between runs in milliseconds | `0` |
| `--max-body <bytes>` | Maximum response body bytes to read | `10485760` (10 MiB) |
| `--insecure` | Skip TLS certificate verification | `false` |
| `--allow-private` | Allow private/loopback addresses (bypass SSRF guard) | `false` |
| `--timeout <ms>` | Timeout for all stages in milliseconds | no timeout |
| `--timeout <spec>` | Per-stage timeouts (e.g., `dns=1000,tcp=2000,ttfb=5000`) | no timeout |
| `--json` | Output results as JSON | `false` |
| `--explain` | Show what would be done without executing | `false` |
| `--help` | Show help message | — |
| `--version` | Show version and exit | — |

## Output Formats

### Human-Readable (default)

```
Target: https://example.com (93.184.216.34 - IPv4)
Runs: 5 successful runs

Stage             Median        Min        Max
----------------------------------------------
DNS Lookup            12.34 ms      8.12 ms     18.45 ms
TCP Connect           45.67 ms     42.11 ms     52.33 ms
TLS Handshake         89.12 ms     85.44 ms     94.22 ms
TTFB                 123.45 ms    118.22 ms    132.11 ms
Body Download          5.67 ms      4.11 ms      7.88 ms
----------------------------------------------
Total               276.25 ms    265.00 ms    298.99 ms
```

### JSON (--json)

```json
{
  "stages": {
    "dns": { "medianMs": 12.34, "minMs": 8.12, "maxMs": 18.45 },
    "tcp": { "medianMs": 45.67, "minMs": 42.11, "maxMs": 52.33 },
    "tls": { "medianMs": 89.12, "minMs": 85.44, "maxMs": 94.22 },
    "ttfb": { "medianMs": 123.45, "minMs": 118.22, "maxMs": 132.11 },
    "body": { "medianMs": 5.67, "minMs": 4.11, "maxMs": 7.88 }
  },
  "total": { "medianMs": 276.25, "minMs": 265.00, "maxMs": 298.99 },
  "runsRequested": 5,
  "runsSuccessful": 5,
  "runsFailed": 0,
  "url": "https://example.com",
  "ip": "93.184.216.34",
  "family": "IPv4",
  "warnings": []
}
```

### Dry-Run (--explain)

```
Would run probes with the following configuration:

Parsed CLI Options:
  URL: https://example.com
  Runs: 5
  Concurrency: 1
  Delay: 0ms
  Max body: 10485760 bytes
  Insecure (skip TLS verify): false
  Allow private addresses: false
  Timeout: none
  Output format: human-readable table

Resolved Configuration:
  Scheme: https
  Hostname: example.com
  Port: 443
  Resolved IP: 93.184.216.34 (IPv4)

Stages to Run:
  DNS: default timeout
  TCP: default timeout
  TLS: default timeout
  TTFB: default timeout
  Body: default timeout

Estimated Time:
  Total: ~1.2s
  (Based on 5 run(s), 1 concurrent, 0ms delay between runs)
```

## Exit Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | `OK` | All runs successful |
| 1 | `INVALID_ARGS` | Invalid command-line arguments |
| 2 | `DNS_FAILED` | DNS resolution failed or SSRF guard blocked |
| 3 | `TCP_FAILED` | TCP connection failed |
| 4 | `TLS_FAILED` | TLS handshake failed |
| 5 | `HTTP_FAILED` | HTTP request failed (TTFB/body/status) |
| 6 | `ALL_RUNS_FAILED` | All probe runs failed |
| 255 | `INTERNAL_ERROR` | Unexpected internal error |

Errors are printed to stderr; results are printed to stdout.

## Stages Measured

1. **DNS Lookup** — Time to resolve hostname to IP address(es)
2. **TCP Connect** — Time to establish TCP connection
3. **TLS Handshake** — Time for TLS handshake (0 for HTTP)
4. **TTFB** — Time to First Byte (from request sent to first response byte)
5. **Body Download** — Time to download response body (capped by `--max-body`)

## SSRF Protection

Network Atonomy includes a built-in SSRF (Server-Side Request Forgery) guard:

- Resolves all A/AAAA records for the hostname
- Checks **every** resolved IP against blocked ranges (RFC 1918 private, RFC 3927 link-local, RFC 5735 special-use, RFC 4193 unique local, loopback, multicast, etc.)
- If **any** resolved IP is blocked, the request is aborted before any connection
- Connects only to the first allowed IP (prefers IPv4)
- Bypass with `--allow-private` for local testing

## Per-Stage Timeouts

Use `--timeout` with a comma-separated spec for per-stage timeouts:

```bash
# All stages: 5 seconds
npx networkatonomy https://example.com --timeout 5000

# Per-stage timeouts
npx networkatonomy https://example.com --timeout "dns=1000,tcp=2000,tls=3000,ttfb=5000,body=10000"
```

Stages not specified use their default (no timeout).

## Concurrency

Use `--concurrency` to run multiple probes in parallel:

```bash
# 10 runs, up to 3 at a time
npx networkatonomy https://example.com --runs 10 --concurrency 3
```

Delays (`--delay`) apply between runs within each concurrency batch.

## Local Development / Testing

To test against a local server, use `--allow-private` to bypass the SSRF guard:

```bash
# Start a local server on port 8080
python3 -m http.server 8080

# In another terminal
npx networkatonomy http://127.0.0.1:8080 --allow-private --runs 3
```

## Project Structure

```
src/
├── cli.ts              # CLI entry point, argument parsing, output formatting
├── runner.ts           # Run orchestration, median calculation
├── json.ts             # JSON serialization/parsing with schema validation
├── errors.ts           # Typed error hierarchy and exit codes
├── url/
│   └── validate.ts     # URL validation (WHATWG URL, length, purity)
├── net/
│   ├── address.ts      # IPv4/IPv6 classification, CIDR matching
│   └── resolve.ts      # DNS resolution with SSRF guard
└── stages/
    ├── dns.ts          # DNS timing stage
    ├── tcp.ts          # TCP connect timing stage
    ├── tls.ts          # TLS handshake timing stage
    └── http.ts         # HTTP TTFB + body timing stage
```

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- src/__tests__/integration.test.ts
```

Tests use local ephemeral HTTP/HTTPS servers (no external network calls).

## Requirements

- Node.js 18+ (for `node:dns/promises`, `node:perf_hooks`, `net`, `tls`, `http` modules)
- TypeScript 5.9+ (for development)

## License

MIT