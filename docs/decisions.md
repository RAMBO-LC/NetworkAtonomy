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