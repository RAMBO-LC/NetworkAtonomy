# Decisions

Each entry has a status, reason, and rejected option. Never edit old entries to hide a change — add a superseding entry instead.

## D-001: Connect to the checked IP address (SSRF protection)

- **Status:** Proposed (pending spec approval)
- **Reason:** Connecting by hostname again after DNS resolution allows DNS rebinding attacks. The IP is validated first, then used for the actual connection.
- **Rejected:** Check the hostname, then connect by hostname.

## D-002: Use Node.js built-in `dns`, `net`, `tls`, and `https` modules for timing

- **Status:** Proposed (pending spec approval)
- **Reason:** No extra dependencies, and exact control over stage boundaries.
- **Rejected:** Third-party timing libraries.

## D-003: v1 does not follow HTTP redirects (3xx)

- **Status:** Proposed (pending spec approval)
- **Reason:** Timing cross-origin or multi-hop redirects introduces ambiguity into individual stage boundaries. v1 probes the exact target URL only.
- **Rejected:** Auto-follow redirects and time each hop.

## D-004: Address selection prefers IPv4 when both A and AAAA records exist

- **Status:** Proposed (pending spec approval)
- **Reason:** Consistent timing benchmarks across runs; IPv4 is more widely deployed and avoids Happy Eyeballs variability.
- **Rejected:** Use Node's default Happy Eyeballs algorithm; prefer IPv6.

## D-005: TLS session resumption disabled per run (`sessionTimeout: 0`, fresh socket)

- **Status:** Proposed (pending spec approval)
- **Reason:** Ensures each run measures a full handshake; prevents resumed sessions from skewing TLS timing.
- **Rejected:** Allow default TLS session caching.

## D-006: Blocked IP ranges — exactly as listed in `docs/parameters.md`

- **Status:** Proposed (pending spec approval)
- **Reason:** Comprehensive coverage of private, loopback, link-local, unspecified, multicast, and reserved ranges for both IPv4 and IPv6.
- **Rejected:** Smaller subset of ranges; dynamic blocklist.

## D-007: Median of successful runs only; warning if any runs fail; exit non-zero if all fail

- **Status:** Proposed (pending spec approval)
- **Reason:** Robust against transient network errors while still surfacing persistent failures.
- **Rejected:** Fail the whole probe if any single run fails; or silently drop failed runs without warning.