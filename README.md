# reqanatomy

A command-line tool that times each stage of loading a URL (DNS, TCP connect, TLS handshake, time to first byte, body download) and prints the median of several runs.

**Status:** pre-alpha, planning.

**Planned usage:**

```
reqanatomy https://example.com
reqanatomy https://example.com --runs 5 --explain
reqanatomy https://example.com --json
```

**Limits:** one probe location, results vary with network conditions, private and loopback addresses are blocked.

**Documentation:**

- [[docs/overview.md]] — the idea
- [[docs/challenges.md]] — risks and open questions
- [[docs/parameters.md]] — settings reference
- [[docs/planning.md]] — phases and milestones
- [[docs/spec.md]] — full specification (Phase 2)
- [[docs/plan.md]] — task plan (Phase 2)
- [[docs/decisions.md]] — design decisions
- [[AGENT.md]] — agent rules
