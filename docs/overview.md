# Overview

## The Problem

When a web page loads slowly, developers and learners see a single total — not where the time goes. You know the page took 8 seconds, but not whether that was DNS, TCP, TLS, or the body download.

## The Basic Idea

A CLI that times each stage of a page load and explains it. One probe, five stages, median of several runs, optional explanations, JSON output.

## Users

- **Developers debugging slowness** — see which stage dominates.
- **Students and teachers learning how the web works** — stage-by-stage breakdown with explanations.

## What It Is

| Property | Value |
|----------|-------|
| Probe locations | One |
| Stages | DNS, TCP connect, TLS handshake, TTFB, body download |
| Aggregation | Median of N runs |
| Output modes | Plain text, `--explain`, `--json` |

## What It Is Not

- Not a load tester (no concurrency, no ramping).
- Not a monitoring service (no uptime, no thresholds, no alerts).
- Not a browser (no rendering, no JS execution).
- Not a replacement for DevTools or `curl -w`.

## Success Criteria for v1

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Stage totals agree with `curl -w` within a tolerance (to be defined) | PROPOSED |
| 2 | SSRF guard blocks every address in the blocked ranges in the test suite | PROPOSED |
| 3 | `--json` output is valid JSON with the documented field names | PROPOSED |
| 4 | Median of 5 runs is stable across repeated invocations on the same URL | PROPOSED |
| 5 | `--explain` produces plain-language output for each stage | PROPOSED |

## Glossary

| Term | Definition |
|------|------------|
| **DNS** | Domain Name System. Translates a hostname (e.g. `example.com`) to an IP address. |
| **TCP** | Transmission Control Protocol. The connection-oriented transport layer under HTTP. |
| **TLS** | Transport Layer Security. The cryptographic protocol that secures HTTPS connections. |
| **SNI** | Server Name Indication. A TLS extension that sends the hostname during the handshake, needed for virtual hosting. |
| **TTFB** | Time to First Byte. The duration from the request being sent to the first response byte arriving. |
| **Median** | The middle value in a sorted list of measurements. Outlier-resistant compared to mean. |
| **SSRF** | Server-Side Request Forgery. An attack where a server is tricked into making requests to internal addresses. |
| **DNS Rebinding** | An attack where a DNS name resolves to a safe IP first, then a private IP later, bypassing hostname checks. |