/**
 * DNS resolution timing stage.
 *
 * Measures the time spent resolving A (IPv4) and AAAA (IPv6) records for a
 * hostname using an injectable resolver. The timer starts immediately before
 * the resolver is invoked and stops once all addresses have been returned.
 *
 * The resolver is injected so tests can supply a fake resolver without any
 * network connectivity (see docs/spec.md Section 10).
 */

import { performance } from "node:perf_hooks";
import { defaultDnsResolver, type DnsResolver } from "../net/resolve";

/**
 * Resolved addresses returned by the DNS stage.
 */
export interface DnsAddresses {
  /** IPv4 (A) records. */
  ipv4: string[];
  /** IPv6 (AAAA) records. */
  ipv6: string[];
}

/**
 * Result of measuring the DNS resolution stage.
 */
export interface DnsTimingResult {
  /** Duration of the resolution in milliseconds (high-resolution). */
  durationMs: number;
  /** The addresses returned by the resolver. */
  addresses: DnsAddresses;
}

/**
 * Measure DNS resolution time for a hostname.
 *
 * @param hostname - The hostname to resolve.
 * @param resolver - Optional injectable DNS resolver. Defaults to the
 *                   Node.js `dns/promises`-based resolver from Task 4.
 * @returns The resolution duration in ms and the resolved addresses.
 */
export async function measureDns(
  hostname: string,
  resolver: DnsResolver = defaultDnsResolver,
): Promise<DnsTimingResult> {
  const start = performance.now();
  const addresses = await resolver(hostname);
  const end = performance.now();

  return {
    durationMs: end - start,
    addresses,
  };
}