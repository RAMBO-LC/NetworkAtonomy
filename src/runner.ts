/**
 * Runs orchestration and median calculation.
 *
 * Executes N probe runs sequentially (or with concurrency options), collects
 * timing results for each stage (DNS, TCP, TLS, TTFB, Body, Total), calculates
 * median/min/max for each metric, and handles run failures/retries.
 */

import { performance } from "node:perf_hooks";
import { validateUrl, type ValidUrl } from "./url/validate";
import { resolveHostname, type ResolvedHost } from "./net/resolve";
import { measureDns, type DnsTimingResult } from "./stages/dns";
import { measureTcp, type TcpTimingResult } from "./stages/tcp";
import { measureTls, type TlsTimingResult } from "./stages/tls";
import { measureHttp, type HttpTimingResult, type HttpTimingOptions } from "./stages/http";

/**
 * Timing results for a single run across all stages.
 */
export interface RunTimingResult {
  /** DNS resolution duration in ms. */
  dnsMs: number;
  /** TCP connection duration in ms. */
  tcpMs: number;
  /** TLS handshake duration in ms (0 for HTTP). */
  tlsMs: number;
  /** Time to First Byte in ms. */
  ttfbMs: number;
  /** Body download duration in ms. */
  bodyMs: number;
  /** Total duration for this run in ms. */
  totalMs: number;
  /** HTTP status code from the response. */
  statusCode: number;
  /** Bytes received in the response body. */
  bytesReceived: number;
  /** The IP address connected to. */
  ip: string;
  /** Address family (IPv4 or IPv6). */
  family: "ipv4" | "ipv6";
}

/**
 * Aggregated statistics for a single stage across multiple runs.
 */
export interface StageStats {
  /** Median duration in ms. */
  medianMs: number;
  /** Minimum duration in ms. */
  minMs: number;
  /** Maximum duration in ms. */
  maxMs: number;
}

/**
 * Aggregated results across all successful runs.
 */
export interface AggregatedResults {
  /** Per-stage statistics. */
  stages: {
    dns: StageStats;
    tcp: StageStats;
    tls: StageStats;
    ttfb: StageStats;
    body: StageStats;
  };
  /** Total time statistics (median of per-run totals). */
  total: StageStats;
  /** Number of runs requested. */
  runsRequested: number;
  /** Number of runs that succeeded. */
  runsSuccessful: number;
  /** Number of runs that failed. */
  runsFailed: number;
  /** Target URL. */
  url: string;
  /** Connected IP address. */
  ip: string;
  /** Address family. */
  family: "IPv4" | "IPv6";
  /** HTTP status code from the first successful run. */
  statusCode: number;
  /** Warnings from failed runs (if any). */
  warnings: string[];
  /** Per-hop timing results for redirect chain. */
  hops: HopResult[];
}

/** Timing results for a single redirect hop. */
export interface HopResult {
  /** The URL that was requested for this hop. */
  url: string;
  /** HTTP status code for this hop. */
  statusCode: number;
  /** Per-stage statistics for this hop. */
  stages: {
    dns: StageStats;
    tcp: StageStats;
    tls: StageStats;
    ttfb: StageStats;
    body: StageStats;
  };
}

/**
 * Timing results for a single hop within a single run.
 */
interface HopTimingResult {
  url: string;
  statusCode: number;
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  bodyMs: number;
  totalMs: number;
  ip: string;
  family: "ipv4" | "ipv6";
}

/**
 * Options for configuring a probe run.
 */
export interface ProbeOptions {
  /** The validated URL to probe. */
  url: ValidUrl;
  /** Number of runs to execute. Default: 5. */
  runs?: number;
  /** Delay between runs in ms. Default: 0. */
  delayMs?: number;
  /** Maximum concurrent runs. Default: 1 (sequential). */
  concurrency?: number;
  /** Maximum body bytes to read. Default: 10 MiB. */
  maxBody?: number;
  /** Whether to skip TLS certificate verification. Default: false. */
  rejectUnauthorized?: boolean;
  /** Whether to allow private/loopback addresses (bypass SSRF guard). Default: false. */
  allowPrivate?: boolean;
  /** Maximum redirect hops to follow. Default: 5. */
  maxRedirects?: number;
  /** Per-stage timeouts in ms. */
  timeouts?: {
    dns?: number;
    tcp?: number;
    tls?: number;
    ttfb?: number;
    body?: number;
  };
  /** Optional injected DNS resolver for testing. */
  dnsResolver?: (hostname: string) => Promise<{ ipv4: string[]; ipv6: string[] }>;
}

/**
 * Result of a single run attempt (success or failure).
 */
export interface RunAttemptResult {
  success: boolean;
  timing?: RunTimingResult & { hops: HopTimingResult[] };
  error?: Error;
}

/**
 * Calculate median of an array of numbers.
 */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    // sorted has at least 2 elements here, so mid-1 and mid are valid indices
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  // sorted has at least 1 element here, so mid is a valid index
  return sorted[mid]!;
}

/**
 * Calculate StageStats from an array of values.
 */
export function calculateStageStats(values: number[]): StageStats {
  if (values.length === 0) {
    return { medianMs: 0, minMs: 0, maxMs: 0 };
  }
  return {
    medianMs: calculateMedian(values),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  };
}

/**
 * Execute a single probe run with redirect following.
 */
export async function executeSingleRun(
  options: ProbeOptions,
  initialResolvedHost: ResolvedHost,
): Promise<RunAttemptResult> {
  const { url: initialUrl, maxBody = 10 * 1024 * 1024, rejectUnauthorized = true, maxRedirects = 5 } = options;
  const maxHops = maxRedirects;

  let currentUrl = initialUrl;
  let currentResolvedHost = initialResolvedHost;
  const visitedUrls = new Set<string>();
  const hopTimings: HopTimingResult[] = [];

  let finalRunTiming: RunTimingResult | null = null;

  for (let hop = 0; hop <= maxHops; hop++) {
    // Check for redirect loop
    const urlKey = currentUrl.input;
    if (visitedUrls.has(urlKey)) {
      throw new Error(`Redirect loop detected: ${urlKey}`);
    }
    visitedUrls.add(urlKey);

    const { hostname, port, scheme } = currentUrl;

    try {
      // Stage 1: DNS Resolution
      const dnsStart = performance.now();
      const dnsResult = await measureDns(hostname, options.dnsResolver);
      const dnsMs = performance.now() - dnsStart;

      // Stage 2: TCP Connection
      const tcpResult = await measureTcp(currentResolvedHost.address, port);
      const tcpMs = tcpResult.durationMs;

      // Stage 3: TLS Handshake
      const tlsResult = await measureTls({
        socket: tcpResult.socket,
        hostname,
        protocol: scheme + ":",
        rejectUnauthorized,
      });
      const tlsMs = tlsResult.durationMs;

      // Stage 4 & 5: HTTP Request (TTFB + Body)
      const httpOptions: HttpTimingOptions = {
        socket: tlsResult.socket,
        hostname,
        path: currentUrl.input.includes("://") ? new URL(currentUrl.input).pathname + new URL(currentUrl.input).search : "/",
        port: port !== (scheme === "http" ? 80 : 443) ? port : undefined,
        maxBody,
        protocol: scheme + ":",
      };
      const httpResult = await measureHttp(httpOptions);
      const ttfbMs = httpResult.ttfbMs;
      const bodyMs = httpResult.bodyMs;

      const totalMs = dnsMs + tcpMs + tlsMs + ttfbMs + bodyMs;

      // Record this hop's timing
      const hopTiming: HopTimingResult = {
        url: currentUrl.input,
        statusCode: httpResult.statusCode,
        dnsMs,
        tcpMs,
        tlsMs,
        ttfbMs,
        bodyMs,
        totalMs,
        ip: currentResolvedHost.address,
        family: currentResolvedHost.family,
      };
      hopTimings.push(hopTiming);

      // Check if this is a redirect (3xx)
      const isRedirect = httpResult.statusCode >= 300 && httpResult.statusCode < 400;

      if (!isRedirect) {
        // Final response
        finalRunTiming = {
          dnsMs: hopTimings.reduce((sum, h) => sum + h.dnsMs, 0),
          tcpMs: hopTimings.reduce((sum, h) => sum + h.tcpMs, 0),
          tlsMs: hopTimings.reduce((sum, h) => sum + h.tlsMs, 0),
          ttfbMs: hopTimings.reduce((sum, h) => sum + h.ttfbMs, 0),
          bodyMs: hopTimings.reduce((sum, h) => sum + h.bodyMs, 0),
          totalMs: hopTimings.reduce((sum, h) => sum + h.totalMs, 0),
          statusCode: httpResult.statusCode,
          bytesReceived: httpResult.bytesReceived,
          ip: currentResolvedHost.address,
          family: currentResolvedHost.family,
        };
        break;
      }

      // It's a redirect - check if we've exceeded max redirects
      if (hop >= maxHops) {
        throw new Error(`Too many redirects (max: ${maxHops})`);
      }

      // Follow the redirect
      const location = httpResult.location;
      if (!location) {
        throw new Error(`Redirect status ${httpResult.statusCode} but no Location header`);
      }

      // Resolve the redirect URL against the current URL
      let redirectUrl: URL;
      try {
        redirectUrl = new URL(location, currentUrl.input);
      } catch {
        throw new Error(`Invalid Location header: ${location}`);
      }

      // Validate scheme - only http or https allowed
      if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
        throw new Error(`Redirect to unsupported scheme: ${redirectUrl.protocol}`);
      }

      // Resolve the new hostname with SSRF check
      const newHostname = redirectUrl.hostname;
      const newPort = redirectUrl.port ? parseInt(redirectUrl.port, 10) : (redirectUrl.protocol === "https:" ? 443 : 80);
      const newScheme = redirectUrl.protocol.slice(0, -1); // "http:" -> "http"

      // Resolve with SSRF check (allowPrivate applies to all hops)
      currentResolvedHost = await resolveHostname(newHostname, options.dnsResolver, options.allowPrivate);

      // Create new ValidUrl for the redirect target
      // We need to create a ValidUrl-like object
      currentUrl = {
        input: redirectUrl.toString(),
        hostname: newHostname,
        port: newPort,
        scheme: newScheme,
      } as ValidUrl;
    } catch (error) {
      // Clean up socket on error
      throw error;
    }
  }

  if (!finalRunTiming) {
    throw new Error("Too many redirects");
  }

  return {
    success: true,
    timing: {
      ...finalRunTiming,
      hops: hopTimings,
    },
  };
}

/**
 * Execute multiple runs with optional concurrency control.
 */
async function executeRuns(
  options: ProbeOptions,
  resolvedHost: ResolvedHost,
): Promise<RunAttemptResult[]> {
  const { runs = 5, delayMs = 0, concurrency = 1 } = options;
  const results: RunAttemptResult[] = [];

  if (concurrency <= 1) {
    // Sequential execution
    for (let i = 0; i < runs; i++) {
      try {
        const result = await executeSingleRun(options, resolvedHost);
        results.push(result);
      } catch (error) {
        // Per spec section 7: a failed run is recorded as a failure, not an abort.
        results.push({ success: false, error: error instanceof Error ? error : new Error(String(error)) });
      }
      if (i < runs - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } else {
    // Concurrent execution with limited concurrency
    const queue = Array.from({ length: runs }, (_, i) => i);
    const running = new Set<Promise<void>>();

    const runNext = async (index: number): Promise<void> => {
      try {
        const result = await executeSingleRun(options, resolvedHost);
        results[index] = result;
      } catch (error) {
        // Per spec section 7: a failed run is recorded as a failure, not an abort.
        results[index] = { success: false, error: error instanceof Error ? error : new Error(String(error)) };
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    };

    for (const index of queue) {
      const promise = runNext(index).then(() => {
        running.delete(promise);
      });
      running.add(promise);

      if (running.size >= concurrency) {
        await Promise.race(running);
      }
    }

    await Promise.all(running);
  }

  return results;
}

/**
 * Main entry point: run probes and return aggregated results.
 *
 * @param inputUrl - The URL string to probe (will be validated).
 * @param options - Probe configuration options.
 * @returns Aggregated timing statistics across all runs.
 * @throws {Error} If URL validation fails or all runs fail.
 */
export async function runProbes(
  inputUrl: string,
  options: Omit<ProbeOptions, "url"> = {},
): Promise<AggregatedResults> {
  // Validate URL
  const validation = validateUrl(inputUrl);
  if (!validation.ok) {
    throw new Error(`Error: ${validation.message}`);
  }

  const { runs = 5, ...probeOptions } = options;
  const probeOpts: ProbeOptions = { url: validation, runs, ...probeOptions };

  // Resolve hostname once (reused across runs for SSRF protection)
  const resolvedHost = await resolveHostname(validation.hostname, probeOpts.dnsResolver, probeOpts.allowPrivate);

  // Execute runs
  const runResults = await executeRuns(probeOpts, resolvedHost);

  // Separate successful and failed runs
  const successfulRuns = runResults.filter((r): r is RunAttemptResult & { timing: RunTimingResult & { hops: HopTimingResult[] } } => r.success);
  const failedRuns = runResults.filter((r) => !r.success);

  // If all runs failed, throw an error
  if (successfulRuns.length === 0) {
    const firstError = failedRuns[0]?.error;
    throw firstError ?? new Error("All runs failed with unknown error");
  }

  // Collect timing values per stage
  const dnsValues = successfulRuns.map((r) => r.timing.dnsMs);
  const tcpValues = successfulRuns.map((r) => r.timing.tcpMs);
  const tlsValues = successfulRuns.map((r) => r.timing.tlsMs);
  const ttfbValues = successfulRuns.map((r) => r.timing.ttfbMs);
  const bodyValues = successfulRuns.map((r) => r.timing.bodyMs);
  const totalValues = successfulRuns.map((r) => r.timing.totalMs);

  // Calculate statistics
  const dnsStats = calculateStageStats(dnsValues);
  const tcpStats = calculateStageStats(tcpValues);
  const tlsStats = calculateStageStats(tlsValues);
  const ttfbStats = calculateStageStats(ttfbValues);
  const bodyStats = calculateStageStats(bodyValues);
  const totalStats = calculateStageStats(totalValues);

  // Aggregate hop timings across runs
  // For simplicity, use the first successful run's hop data
  const firstRunHops = successfulRuns[0]!.timing.hops;
  const aggregatedHops: HopResult[] = firstRunHops.map((hop) => ({
    url: hop.url,
    statusCode: hop.statusCode,
    stages: {
      dns: { medianMs: hop.dnsMs, minMs: hop.dnsMs, maxMs: hop.dnsMs },
      tcp: { medianMs: hop.tcpMs, minMs: hop.tcpMs, maxMs: hop.tcpMs },
      tls: { medianMs: hop.tlsMs, minMs: hop.tlsMs, maxMs: hop.tlsMs },
      ttfb: { medianMs: hop.ttfbMs, minMs: hop.ttfbMs, maxMs: hop.ttfbMs },
      body: { medianMs: hop.bodyMs, minMs: hop.bodyMs, maxMs: hop.bodyMs },
    },
  }));

  // Prepare warnings
  const warnings: string[] = [];
  if (failedRuns.length > 0) {
    warnings.push(`Warning: ${failedRuns.length} of ${runs} runs failed.`);
  }

  return {
    stages: {
      dns: dnsStats,
      tcp: tcpStats,
      tls: tlsStats,
      ttfb: ttfbStats,
      body: bodyStats,
    },
    total: totalStats,
    runsRequested: runs,
    runsSuccessful: successfulRuns.length,
    runsFailed: failedRuns.length,
    url: inputUrl,
    ip: resolvedHost.address,
    family: resolvedHost.family === "ipv4" ? "IPv4" : "IPv6",
    statusCode: successfulRuns[0]!.timing.statusCode,
    warnings,
    hops: aggregatedHops,
  };
}

/**
 * Format a duration in ms to a string with 2 decimal places.
 */
export function formatMs(ms: number): string {
  return ms.toFixed(2);
}

/**
 * Print aggregated results in human-readable terminal format.
 */
export function printResults(results: AggregatedResults): void {
  console.log(`Target: ${results.url} (${results.ip} - ${results.family})`);
  console.log(`Runs: ${results.runsSuccessful} successful runs`);
  if (results.runsFailed > 0) {
    console.log(`Failed: ${results.runsFailed} runs`);
  }
  console.log("");
  console.log("Stage             Median        Min        Max");
  console.log("----------------------------------------------");
  console.log(`DNS Lookup       ${formatMs(results.stages.dns.medianMs).padStart(8)} ms  ${formatMs(results.stages.dns.minMs).padStart(8)} ms  ${formatMs(results.stages.dns.maxMs).padStart(8)} ms`);
  console.log(`TCP Connect      ${formatMs(results.stages.tcp.medianMs).padStart(8)} ms  ${formatMs(results.stages.tcp.minMs).padStart(8)} ms  ${formatMs(results.stages.tcp.maxMs).padStart(8)} ms`);
  console.log(`TLS Handshake    ${formatMs(results.stages.tls.medianMs).padStart(8)} ms  ${formatMs(results.stages.tls.minMs).padStart(8)} ms  ${formatMs(results.stages.tls.maxMs).padStart(8)} ms`);
  console.log(`TTFB             ${formatMs(results.stages.ttfb.medianMs).padStart(8)} ms  ${formatMs(results.stages.ttfb.minMs).padStart(8)} ms  ${formatMs(results.stages.ttfb.maxMs).padStart(8)} ms`);
  console.log(`Body Download    ${formatMs(results.stages.body.medianMs).padStart(8)} ms  ${formatMs(results.stages.body.minMs).padStart(8)} ms  ${formatMs(results.stages.body.maxMs).padStart(8)} ms`);
  console.log("----------------------------------------------");
  console.log(`Total (median of per-run totals) ${formatMs(results.total.medianMs).padStart(8)} ms  ${formatMs(results.total.minMs).padStart(8)} ms  ${formatMs(results.total.maxMs).padStart(8)} ms`);
  console.log("");

  for (const warning of results.warnings) {
    console.log(warning);
  }
}