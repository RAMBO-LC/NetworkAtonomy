/**
 * Runs orchestration and median calculation.
 *
 * Executes N probe runs sequentially (or with concurrency options), collects
 * timing results for each stage (DNS, TCP, TLS, TTFB, Body, Total), calculates
 * median/min/max for each metric, and handles run failures/retries.
 */
import { performance } from "node:perf_hooks";
import { validateUrl } from "./url/validate";
import { resolveHostname, ResolutionError, BlockedAddressError } from "./net/resolve";
import { measureDns } from "./stages/dns";
import { measureTcp } from "./stages/tcp";
import { measureTls } from "./stages/tls";
import { measureHttp } from "./stages/http";
import { ExitCode, NetworkAtonomyError, InvalidArgsError, RedirectLoopError, TooManyRedirectsError, TimeoutError, InternalError, TcpFailedError, TlsFailedError, HttpFailedError, DnsFailedError, } from "./errors";
/**
 * Calculate median of an array of numbers.
 */
export function calculateMedian(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        // sorted has at least 2 elements here, so mid-1 and mid are valid indices
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    // sorted has at least 1 element here, so mid is a valid index
    return sorted[mid];
}
/**
 * Calculate StageStats from an array of values.
 */
export function calculateStageStats(values) {
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
async function executeSingleRun(options, initialResolvedHost) {
    const { url: initialUrl, maxBody = 10 * 1024 * 1024, rejectUnauthorized = true, maxRedirects = 5 } = options;
    const maxHops = maxRedirects;
    let currentUrl = initialUrl;
    let currentResolvedHost = initialResolvedHost;
    const visitedUrls = new Set();
    const hopTimings = [];
    let finalRunTiming = null;
    for (let hop = 0; hop <= maxHops; hop++) {
        // Check for redirect loop
        const urlKey = currentUrl.input;
        if (visitedUrls.has(urlKey)) {
            throw new RedirectLoopError(`Redirect loop detected: ${urlKey}`);
        }
        visitedUrls.add(urlKey);
        const { hostname, port, scheme } = currentUrl;
        try {
            // Stage 1: DNS Resolution
            let dnsResult;
            let dnsMs;
            try {
                const dnsStart = performance.now();
                dnsResult = await measureDns(hostname, options.dnsResolver);
                dnsMs = performance.now() - dnsStart;
            }
            catch (err) {
                throw new DnsFailedError(err instanceof Error ? err.message : String(err));
            }
            // Stage 2: TCP Connection
            let tcpResult;
            let tcpMs;
            try {
                tcpResult = await measureTcp(currentResolvedHost.address, port);
                tcpMs = tcpResult.durationMs;
            }
            catch (err) {
                throw new TcpFailedError(err instanceof Error ? err.message : String(err));
            }
            // Stage 3: TLS Handshake
            let tlsResult;
            let tlsMs;
            try {
                tlsResult = await measureTls({
                    socket: tcpResult.socket,
                    hostname,
                    protocol: scheme + ":",
                    rejectUnauthorized,
                });
                tlsMs = tlsResult.durationMs;
            }
            catch (err) {
                throw new TlsFailedError(err instanceof Error ? err.message : String(err));
            }
            // Stage 4 & 5: HTTP Request (TTFB + Body)
            let httpResult;
            let ttfbMs;
            let bodyMs;
            try {
                const httpOptions = {
                    socket: tlsResult.socket,
                    hostname,
                    path: currentUrl.input.includes("://") ? new URL(currentUrl.input).pathname + new URL(currentUrl.input).search : "/",
                    port: port !== (scheme === "http" ? 80 : 443) ? port : undefined,
                    maxBody,
                    protocol: scheme + ":",
                };
                httpResult = await measureHttp(httpOptions);
                ttfbMs = httpResult.ttfbMs;
                bodyMs = httpResult.bodyMs;
            }
            catch (err) {
                throw new HttpFailedError(err instanceof Error ? err.message : String(err));
            }
            const totalMs = dnsMs + tcpMs + tlsMs + ttfbMs + bodyMs;
            // Record this hop's timing
            const hopTiming = {
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
                throw new TooManyRedirectsError(`Too many redirects (max: ${maxHops})`);
            }
            // Follow the redirect
            const location = httpResult.location;
            if (!location) {
                throw new Error(`Redirect status ${httpResult.statusCode} but no Location header`);
            }
            // Resolve the redirect URL against the current URL
            let redirectUrl;
            try {
                redirectUrl = new URL(location, currentUrl.input);
            }
            catch {
                throw new InvalidArgsError(`Invalid Location header: ${location}`);
            }
            // Validate scheme - only http or https allowed
            if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
                throw new InvalidArgsError(`Redirect to unsupported scheme: ${redirectUrl.protocol}`);
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
            };
        }
        catch (error) {
            // Clean up socket on error
            throw error;
        }
    }
    if (!finalRunTiming) {
        throw new TooManyRedirectsError("Too many redirects");
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
async function executeRuns(options, resolvedHost) {
    const { runs = 5, delayMs = 0, concurrency = 1 } = options;
    const results = [];
    if (concurrency <= 1) {
        // Sequential execution
        for (let i = 0; i < runs; i++) {
            try {
                const result = await executeSingleRun(options, resolvedHost);
                results.push(result);
            }
            catch (error) {
                // Per spec section 7: a failed run is recorded as a failure, not an abort.
                results.push({ success: false, error: error instanceof Error ? error : new Error(String(error)) });
            }
            if (i < runs - 1 && delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
    else {
        // Concurrent execution with limited concurrency
        const queue = Array.from({ length: runs }, (_, i) => i);
        const running = new Set();
        const runNext = async (index) => {
            try {
                const result = await executeSingleRun(options, resolvedHost);
                results[index] = result;
            }
            catch (error) {
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
export async function runProbes(inputUrl, options = {}) {
    // Validate URL
    const validation = validateUrl(inputUrl);
    if (!validation.ok) {
        throw new InvalidArgsError(`Error: ${validation.message}`);
    }
    const { runs = 5, ...probeOptions } = options;
    const probeOpts = { url: validation, runs, ...probeOptions };
    // Resolve hostname once (reused across runs for SSRF protection)
    const resolvedHost = await resolveHostname(validation.hostname, probeOpts.dnsResolver, probeOpts.allowPrivate);
    // Execute runs
    const runResults = await executeRuns(probeOpts, resolvedHost);
    // Separate successful and failed runs
    const successfulRuns = runResults.filter((r) => r.success);
    const failedRuns = runResults.filter((r) => !r.success);
    // If all runs failed, throw an error
    if (successfulRuns.length === 0) {
        const firstError = failedRuns[0]?.error;
        // BlockedAddressError and ResolutionError are not NetworkAtonomyError
        // subclasses (they live in resolve.ts). Re-throw them directly so
        // mapErrorToExitCode in cli.ts can map them by class.
        if (firstError instanceof BlockedAddressError || firstError instanceof ResolutionError) {
            throw firstError;
        }
        if (firstError instanceof NetworkAtonomyError) {
            throw firstError;
        }
        throw new InternalError(firstError?.message ?? "All runs failed with unknown error");
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
    const firstRunHops = successfulRuns[0].timing.hops;
    const aggregatedHops = firstRunHops.map((hop) => ({
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
    const warnings = [];
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
        statusCode: successfulRuns[0].timing.statusCode,
        warnings,
        hops: aggregatedHops,
    };
}
/**
 * Format a duration in ms to a string with 2 decimal places.
 */
export function formatMs(ms) {
    return ms.toFixed(2);
}
/**
 * Print aggregated results in human-readable terminal format.
 */
export function printResults(results) {
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
