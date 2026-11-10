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
  /** Total time statistics (sum of stage medians). */
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
  /** Warnings from failed runs (if any). */
  warnings: string[];
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
interface RunAttemptResult {
  success: boolean;
  timing?: RunTimingResult;
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
 * Execute a single probe run.
 */
async function executeSingleRun(
  options: ProbeOptions,
  resolvedHost: ResolvedHost,
): Promise<RunAttemptResult> {
  const { url, maxBody = 10 * 1024 * 1024, rejectUnauthorized = true, timeouts } = options;
  const { hostname, port, scheme } = url;

  try {
    // Stage 1: DNS Resolution
    const dnsStart = performance.now();
    const dnsResult = await measureDns(hostname, options.dnsResolver);
    const dnsMs = performance.now() - dnsStart;

    // Stage 2: TCP Connection
    const tcpResult = await measureTcp(resolvedHost.address, port);
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
      path: url.input.includes("://") ? new URL(url.input).pathname + new URL(url.input).search : "/",
      port: port !== (scheme === "http" ? 80 : 443) ? port : undefined,
      maxBody,
      protocol: scheme + ":",
    };
    const httpResult = await measureHttp(httpOptions);
    const ttfbMs = httpResult.ttfbMs;
    const bodyMs = httpResult.bodyMs;

    const totalMs = dnsMs + tcpMs + tlsMs + ttfbMs + bodyMs;

    return {
      success: true,
      timing: {
        dnsMs,
        tcpMs,
        tlsMs,
        ttfbMs,
        bodyMs,
        totalMs,
        statusCode: httpResult.statusCode,
        bytesReceived: httpResult.bytesReceived,
        ip: resolvedHost.address,
        family: resolvedHost.family,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
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
      const result = await executeSingleRun(options, resolvedHost);
      results.push(result);
      if (i < runs - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } else {
    // Concurrent execution with limited concurrency
    const queue = Array.from({ length: runs }, (_, i) => i);
    const running = new Set<Promise<void>>();

    const runNext = async (index: number): Promise<void> => {
      const result = await executeSingleRun(options, resolvedHost);
      results[index] = result;
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
  const resolvedHost = await resolveHostname(validation.hostname, probeOpts.dnsResolver);

  // Execute runs
  const runResults = await executeRuns(probeOpts, resolvedHost);

  // Separate successful and failed runs
  const successfulRuns = runResults.filter((r): r is RunAttemptResult & { timing: RunTimingResult } => r.success);
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
    warnings,
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
  console.log(`Total            ${formatMs(results.total.medianMs).padStart(8)} ms  ${formatMs(results.total.minMs).padStart(8)} ms  ${formatMs(results.total.maxMs).padStart(8)} ms`);
  console.log("");

  for (const warning of results.warnings) {
    console.log(warning);
  }
}