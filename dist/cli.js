/**
 * CLI entry point for Network Atonomy.
 *
 * Parses command-line arguments, runs probes, and prints results.
 */
import { runProbes, printResults } from "./runner";
import { validateUrl } from "./url/validate";
import { resolveHostname, defaultDnsResolver, ResolutionError, BlockedAddressError } from "./net/resolve";
import { ExitCode, NetworkAtonomyError, InvalidArgsError, DnsFailedError, TcpFailedError, TlsFailedError, HttpFailedError, TimeoutError, AllRunsFailedError, RedirectLoopError, TooManyRedirectsError, InternalError, getExitCode, } from "./errors";
/**
 * Estimated time per stage in milliseconds (used for dry-run estimation).
 */
const ESTIMATED_STAGE_MS = {
    dns: 50,
    tcp: 100,
    tls: 150,
    ttfb: 200,
    body: 50,
};
/**
 * Parse command-line arguments.
 */
function parseArgs(args) {
    const options = {};
    let positionalArgs = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg)
            continue;
        if (arg.startsWith("--")) {
            const [flag, value] = arg.slice(2).split("=");
            if (!flag)
                continue;
            switch (flag) {
                case "runs":
                    options.runs = parseInt(value ?? args[++i] ?? "", 10);
                    if (isNaN(options.runs) || options.runs <= 0) {
                        throw new InvalidArgsError("--runs must be a positive integer");
                    }
                    break;
                case "concurrency":
                    options.concurrency = parseInt(value ?? args[++i] ?? "", 10);
                    if (isNaN(options.concurrency) || options.concurrency <= 0) {
                        throw new InvalidArgsError("--concurrency must be a positive integer");
                    }
                    break;
                case "delay":
                    options.delayMs = parseInt(value ?? args[++i] ?? "", 10);
                    if (isNaN(options.delayMs) || options.delayMs < 0) {
                        throw new InvalidArgsError("--delay must be a non-negative integer");
                    }
                    break;
                case "max-body":
                    options.maxBody = parseInt(value ?? args[++i] ?? "", 10);
                    if (isNaN(options.maxBody) || options.maxBody <= 0) {
                        throw new InvalidArgsError("--max-body must be a positive integer");
                    }
                    break;
                case "insecure":
                    options.insecure = true;
                    break;
                case "timeout":
                    options.timeout = value ?? args[++i] ?? "";
                    break;
                case "json":
                    options.json = true;
                    break;
                case "explain":
                    options.explain = true;
                    break;
                case "help":
                    options.help = true;
                    break;
                case "version":
                    options.version = true;
                    break;
                case "allow-private":
                    options.allowPrivate = true;
                    break;
                case "max-redirects":
                    options.maxRedirects = parseInt(value ?? args[++i] ?? "", 10);
                    if (isNaN(options.maxRedirects) || options.maxRedirects < 0) {
                        throw new InvalidArgsError("--max-redirects must be a non-negative integer");
                    }
                    break;
                default:
                    throw new InvalidArgsError(`Unknown option: --${flag}`);
            }
        }
        else if (arg.startsWith("-")) {
            // Short flags not supported
            throw new InvalidArgsError(`Short flags not supported: ${arg}. Use --${arg.slice(1)} instead.`);
        }
        else {
            positionalArgs.push(arg);
        }
    }
    if (options.help) {
        console.log(printHelp());
        return { ...options, _exitCode: ExitCode.OK };
    }
    if (options.version) {
        console.log("1.0.0"); // Version would typically come from package.json
        return { ...options, _exitCode: ExitCode.OK };
    }
    if (positionalArgs.length === 0) {
        throw new InvalidArgsError("Missing required argument: URL");
    }
    if (positionalArgs.length > 1) {
        throw new InvalidArgsError("Too many positional arguments. Expected only URL.");
    }
    options.url = positionalArgs[0];
    return options;
}
/**
 * Parse timeout string into per-stage timeouts.
 * Format: "dns=1000,tcp=2000,tls=3000,ttfb=5000,body=10000" or just "5000" for all stages.
 */
function parseTimeouts(timeoutStr) {
    const timeouts = {};
    if (timeoutStr.includes("=")) {
        const pairs = timeoutStr.split(",");
        for (const pair of pairs) {
            if (!pair)
                continue;
            const [stage, value] = pair.split("=");
            const ms = parseInt(value ?? "", 10);
            if (isNaN(ms) || ms <= 0) {
                throw new InvalidArgsError(`Invalid timeout value for ${stage}: ${value}`);
            }
            switch (stage) {
                case "dns":
                case "tcp":
                case "tls":
                case "ttfb":
                case "body":
                    timeouts[stage] = ms;
                    break;
                default:
                    throw new InvalidArgsError(`Unknown timeout stage: ${stage}`);
            }
        }
    }
    else {
        // Apply same timeout to all stages
        const ms = parseInt(timeoutStr, 10);
        if (isNaN(ms) || ms <= 0) {
            throw new InvalidArgsError(`Invalid timeout value: ${timeoutStr}`);
        }
        timeouts.dns = ms;
        timeouts.tcp = ms;
        timeouts.tls = ms;
        timeouts.ttfb = ms;
        timeouts.body = ms;
    }
    return timeouts;
}
/**
 * Print help message.
 */
function printHelp() {
    return `
Network Atonomy - Network timing probe tool

Usage:
  npx networkatonomy <URL> [options]

Options:
  --runs <n>           Number of probe runs (default: 5)
  --concurrency <n>    Maximum concurrent runs (default: 1)
  --delay <ms>         Delay between runs in milliseconds (default: 0)
  --max-body <bytes>   Maximum response body bytes to read (default: 10485760)
  --insecure           Skip TLS certificate verification
  --allow-private      Allow private/loopback addresses (bypass SSRF guard)
  --max-redirects <n>  Maximum redirect hops to follow (default: 5)
  --timeout <ms>       Timeout for all stages in milliseconds
  --timeout <spec>     Per-stage timeouts (e.g., "dns=1000,tcp=2000,ttfb=5000")
  --json               Output results as JSON
  --explain            Show what would be done without executing
  --help               Show this help message

Examples:
  npx networkatonomy https://example.com
  npx networkatonomy https://example.com --runs 10 --concurrency 2
  npx networkatonomy https://example.com --timeout 5000 --json
  npx networkatonomy https://example.com --timeout "dns=1000,tcp=2000,tls=3000,ttfb=5000,body=10000"
  npx networkatonomy http://127.0.0.1:8080 --allow-private
`.trim();
}
/**
 * Print results as JSON.
 */
function printJson(results) {
    console.log(JSON.stringify(results, null, 2));
}
/**
 * Print enhanced explain output showing parsed options, resolved config,
 * estimated time, and stages that will run.
 */
async function printExplainOutput(options) {
    const runs = options.runs ?? 5;
    const concurrency = options.concurrency ?? 1;
    const delayMs = options.delayMs ?? 0;
    const maxBody = options.maxBody ?? 10 * 1024 * 1024;
    const insecure = options.insecure ?? false;
    const allowPrivate = options.allowPrivate ?? false;
    const timeoutStr = options.timeout ?? "none";
    const outputFormat = options.json ? "JSON" : "human-readable table";
    // Validate URL first
    const validation = validateUrl(options.url);
    if (!validation.ok) {
        console.log("Would run probes with the following configuration:");
        console.log(`  URL: ${options.url} (INVALID: ${validation.message})`);
        console.log(`  Runs: ${runs}`);
        console.log(`  Concurrency: ${concurrency}`);
        console.log(`  Delay: ${delayMs}ms`);
        console.log(`  Max body: ${maxBody} bytes`);
        console.log(`  Insecure (skip TLS verify): ${insecure}`);
        console.log(`  Timeout: ${timeoutStr}`);
        console.log(`  Output format: ${outputFormat}`);
        return;
    }
    // Try to resolve hostname for IP display
    let resolvedIp = null;
    let resolvedFamily = null;
    let resolutionError = null;
    try {
        const resolved = await resolveHostname(validation.hostname, defaultDnsResolver, allowPrivate);
        resolvedIp = resolved.address;
        resolvedFamily = resolved.family === "ipv4" ? "IPv4" : "IPv6";
    }
    catch (error) {
        if (error instanceof ResolutionError) {
            resolutionError = `DNS resolution failed: ${error.message}`;
        }
        else if (error instanceof BlockedAddressError) {
            resolutionError = `SSRF guard blocked: ${error.blockedAddresses.join(", ")}`;
        }
        else {
            resolutionError = `Resolution error: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    // Parse timeouts for estimation
    const timeouts = options.timeout ? parseTimeouts(options.timeout) : {};
    // Calculate estimated time
    const estimatedTimeMs = calculateEstimatedTime(runs, concurrency, delayMs, timeouts);
    // Determine stages that will run
    const stages = getStagesToRun(validation.scheme);
    console.log("Would run probes with the following configuration:");
    console.log("");
    console.log("Parsed CLI Options:");
    console.log(`  URL: ${options.url}`);
    console.log(`  Runs: ${runs}`);
    console.log(`  Concurrency: ${concurrency}`);
    console.log(`  Delay: ${delayMs}ms`);
    console.log(`  Max body: ${maxBody} bytes`);
    console.log(`  Insecure (skip TLS verify): ${insecure}`);
    console.log(`  Allow private addresses: ${allowPrivate}`);
    console.log(`  Timeout: ${timeoutStr}`);
    console.log(`  Output format: ${outputFormat}`);
    console.log("");
    console.log("Resolved Configuration:");
    console.log(`  Scheme: ${validation.scheme}`);
    console.log(`  Hostname: ${validation.hostname}`);
    console.log(`  Port: ${validation.port}`);
    if (resolvedIp) {
        console.log(`  Resolved IP: ${resolvedIp} (${resolvedFamily})`);
    }
    else if (resolutionError) {
        console.log(`  Resolved IP: (could not resolve - ${resolutionError})`);
    }
    else {
        console.log(`  Resolved IP: (unknown)`);
    }
    console.log("");
    console.log("Stages to Run:");
    for (const stage of stages) {
        const timeout = timeouts?.[stage] ?? "default";
        console.log(`  ${stage.toUpperCase()}: ${timeout === "default" ? "default timeout" : `${timeout}ms timeout`}`);
    }
    console.log("");
    console.log("Estimated Time:");
    console.log(`  Total: ~${formatEstimatedTime(estimatedTimeMs)}`);
    console.log(`  (Based on ${runs} run(s), ${concurrency} concurrent, ${delayMs}ms delay between runs)`);
}
/**
 * Calculate estimated total time in milliseconds.
 */
function calculateEstimatedTime(runs, concurrency, delayMs, timeouts) {
    // Estimate per-run time based on timeouts or defaults
    const perRunEstimate = (timeouts?.dns ?? ESTIMATED_STAGE_MS.dns) +
        (timeouts?.tcp ?? ESTIMATED_STAGE_MS.tcp) +
        (timeouts?.tls ?? ESTIMATED_STAGE_MS.tls) +
        (timeouts?.ttfb ?? ESTIMATED_STAGE_MS.ttfb) +
        (timeouts?.body ?? ESTIMATED_STAGE_MS.body);
    // With concurrency, runs are batched
    const batches = Math.ceil(runs / concurrency);
    const totalRunTime = perRunEstimate * runs; // Sequential time
    const concurrentRunTime = perRunEstimate * batches; // Concurrent time
    const totalDelay = delayMs * (runs - 1); // Delay between runs
    // For concurrent runs, delay applies within each batch
    // This is a simplified estimation
    return concurrentRunTime + totalDelay;
}
/**
 * Get the list of stages that will run based on scheme.
 */
function getStagesToRun(scheme) {
    const stages = ["dns", "tcp"];
    if (scheme === "https") {
        stages.push("tls");
    }
    stages.push("ttfb", "body");
    return stages;
}
/**
 * Format estimated time in human-readable format.
 */
function formatEstimatedTime(ms) {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    else if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    }
    else {
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(1);
        return `${minutes}m ${seconds}s`;
    }
}
/**
 * Main CLI entry point.
 */
export async function main(argv = process.argv.slice(2)) {
    try {
        const options = parseArgs(argv);
        // Handle help/version flags which return early with exit code
        if ("_exitCode" in options) {
            return options._exitCode;
        }
        if (options.explain) {
            await printExplainOutput(options);
            return ExitCode.OK;
        }
        const probeOptions = {
            runs: options.runs,
            concurrency: options.concurrency,
            delayMs: options.delayMs,
            maxBody: options.maxBody,
            rejectUnauthorized: options.insecure ? false : true,
            timeouts: options.timeout ? parseTimeouts(options.timeout) : undefined,
            allowPrivate: options.allowPrivate,
            maxRedirects: options.maxRedirects ?? 5,
        };
        const results = await runProbes(options.url, probeOptions);
        if (options.json) {
            printJson(results);
        }
        else {
            printResults(results);
        }
        // Exit 0: runProbes already throws if ALL runs failed (mapped to NETWORK_FAILURE
        // by mapErrorToExitCode). Per spec section 7, if at least 1 run succeeds we exit 0
        // with a warning, which is already in results.warnings.
        return ExitCode.OK;
    }
    catch (error) {
        const exitCode = mapErrorToExitCode(error);
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        return exitCode;
    }
}
/**
 * Maps an error to its corresponding ExitCode.
 *
 * Mapping is by error class / exitCode property only. Message-text matching
 * was removed: a reworded message could previously change the exit code, and
 * messages like "timeout" in a TTFB error could mis-map to TIMEOUT (4).
 * Every NetworkAtonomyError subclass carries its own exitCode; plain Errors
 * fall through to INTERNAL_ERROR (255).
 */
function mapErrorToExitCode(error) {
    // Typed errors carry their own exit code. This is the only path that maps
    // to anything other than INTERNAL_ERROR.
    if (error instanceof NetworkAtonomyError) {
        return error.exitCode;
    }
    // BlockedAddressError is NOT a NetworkAtonomyError (it lives in resolve.ts
    // and is thrown by the SSRF guard before any stage runs). Map it by class.
    if (error instanceof BlockedAddressError) {
        return ExitCode.BLOCKED_ADDRESS;
    }
    // ResolutionError is also a plain Error. Map it by class.
    if (error instanceof ResolutionError) {
        return ExitCode.NETWORK_FAILURE;
    }
    // Everything else is unexpected. Exit 255 so a reworded message or a
    // surprise subclass can never silently change the exit code.
    return ExitCode.INTERNAL_ERROR;
}
// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().then((code) => process.exit(code));
}
