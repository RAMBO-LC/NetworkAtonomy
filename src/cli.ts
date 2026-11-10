/**
 * CLI entry point for Network Atonomy.
 *
 * Parses command-line arguments, runs probes, and prints results.
 */

import { runProbes, printResults, type AggregatedResults, type ProbeOptions } from "./runner";
import { validateUrl } from "./url/validate";
import { resolveHostname, defaultDnsResolver, ResolutionError, BlockedAddressError } from "./net/resolve";

interface CliOptions {
  url: string;
  runs?: number;
  concurrency?: number;
  delayMs?: number;
  maxBody?: number;
  insecure?: boolean;
  timeout?: string;
  json?: boolean;
  explain?: boolean;
  help?: boolean;
}

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
function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  let positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const [flag, value] = arg.slice(2).split("=");
      switch (flag) {
        case "runs":
          options.runs = parseInt(value ?? args[++i], 10);
          if (isNaN(options.runs) || options.runs <= 0) {
            throw new Error("--runs must be a positive integer");
          }
          break;
        case "concurrency":
          options.concurrency = parseInt(value ?? args[++i], 10);
          if (isNaN(options.concurrency) || options.concurrency <= 0) {
            throw new Error("--concurrency must be a positive integer");
          }
          break;
        case "delay":
          options.delayMs = parseInt(value ?? args[++i], 10);
          if (isNaN(options.delayMs) || options.delayMs < 0) {
            throw new Error("--delay must be a non-negative integer");
          }
          break;
        case "max-body":
          options.maxBody = parseInt(value ?? args[++i], 10);
          if (isNaN(options.maxBody) || options.maxBody <= 0) {
            throw new Error("--max-body must be a positive integer");
          }
          break;
        case "insecure":
          options.insecure = true;
          break;
        case "timeout":
          options.timeout = value ?? args[++i];
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
        default:
          throw new Error(`Unknown option: --${flag}`);
      }
    } else if (arg.startsWith("-")) {
      // Short flags not supported
      throw new Error(`Short flags not supported: ${arg}. Use --${arg.slice(1)} instead.`);
    } else {
      positionalArgs.push(arg);
    }
  }

  if (options.help) {
    console.log(printHelp());
    return { ...options, _exitCode: 0 } as CliOptions & { _exitCode: number };
  }

  if (positionalArgs.length === 0) {
    throw new Error("Missing required argument: URL");
  }

  if (positionalArgs.length > 1) {
    throw new Error("Too many positional arguments. Expected only URL.");
  }

  options.url = positionalArgs[0];

  return options;
}

/**
 * Parse timeout string into per-stage timeouts.
 * Format: "dns=1000,tcp=2000,tls=3000,ttfb=5000,body=10000" or just "5000" for all stages.
 */
function parseTimeouts(timeoutStr: string): ProbeOptions["timeouts"] {
  const timeouts: ProbeOptions["timeouts"] = {};

  if (timeoutStr.includes("=")) {
    const pairs = timeoutStr.split(",");
    for (const pair of pairs) {
      const [stage, value] = pair.split("=");
      const ms = parseInt(value, 10);
      if (isNaN(ms) || ms <= 0) {
        throw new Error(`Invalid timeout value for ${stage}: ${value}`);
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
          throw new Error(`Unknown timeout stage: ${stage}`);
      }
    }
  } else {
    // Apply same timeout to all stages
    const ms = parseInt(timeoutStr, 10);
    if (isNaN(ms) || ms <= 0) {
      throw new Error(`Invalid timeout value: ${timeoutStr}`);
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
function printHelp(): string {
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
`.trim();
}

/**
 * Print results as JSON.
 */
function printJson(results: AggregatedResults): void {
  console.log(JSON.stringify(results, null, 2));
}

/**
 * Print enhanced explain output showing parsed options, resolved config,
 * estimated time, and stages that will run.
 */
async function printExplainOutput(options: CliOptions): Promise<void> {
  const runs = options.runs ?? 5;
  const concurrency = options.concurrency ?? 1;
  const delayMs = options.delayMs ?? 0;
  const maxBody = options.maxBody ?? 10 * 1024 * 1024;
  const insecure = options.insecure ?? false;
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
  let resolvedIp: string | null = null;
  let resolvedFamily: string | null = null;
  let resolutionError: string | null = null;

  try {
    const resolved = await resolveHostname(validation.hostname, defaultDnsResolver);
    resolvedIp = resolved.address;
    resolvedFamily = resolved.family === "ipv4" ? "IPv4" : "IPv6";
  } catch (error) {
    if (error instanceof ResolutionError) {
      resolutionError = `DNS resolution failed: ${error.message}`;
    } else if (error instanceof BlockedAddressError) {
      resolutionError = `SSRF guard blocked: ${error.blockedAddresses.join(", ")}`;
    } else {
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
  console.log(`  Timeout: ${timeoutStr}`);
  console.log(`  Output format: ${outputFormat}`);
  console.log("");
  console.log("Resolved Configuration:");
  console.log(`  Scheme: ${validation.scheme}`);
  console.log(`  Hostname: ${validation.hostname}`);
  console.log(`  Port: ${validation.port}`);
  if (resolvedIp) {
    console.log(`  Resolved IP: ${resolvedIp} (${resolvedFamily})`);
  } else if (resolutionError) {
    console.log(`  Resolved IP: (could not resolve - ${resolutionError})`);
  } else {
    console.log(`  Resolved IP: (unknown)`);
  }
  console.log("");
  console.log("Stages to Run:");
  for (const stage of stages) {
    const timeout = timeouts[stage] ?? "default";
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
function calculateEstimatedTime(
  runs: number,
  concurrency: number,
  delayMs: number,
  timeouts: ProbeOptions["timeouts"]
): number {
  // Estimate per-run time based on timeouts or defaults
  const perRunEstimate =
    (timeouts.dns ?? ESTIMATED_STAGE_MS.dns) +
    (timeouts.tcp ?? ESTIMATED_STAGE_MS.tcp) +
    (timeouts.tls ?? ESTIMATED_STAGE_MS.tls) +
    (timeouts.ttfb ?? ESTIMATED_STAGE_MS.ttfb) +
    (timeouts.body ?? ESTIMATED_STAGE_MS.body);

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
function getStagesToRun(scheme: "http" | "https"): string[] {
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
function formatEstimatedTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Main CLI entry point.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);

    // Handle help flag which returns early with exit code
    if ("_exitCode" in options) {
      return options._exitCode as number;
    }

    if (options.explain) {
      await printExplainOutput(options);
      return 0;
    }

    const probeOptions: Omit<ProbeOptions, "url"> = {
      runs: options.runs,
      concurrency: options.concurrency,
      delayMs: options.delayMs,
      maxBody: options.maxBody,
      rejectUnauthorized: options.insecure ? false : true,
      timeouts: options.timeout ? parseTimeouts(options.timeout) : undefined,
    };

    const results = await runProbes(options.url, probeOptions);

    if (options.json) {
      printJson(results);
    } else {
      printResults(results);
    }

    // Exit with non-zero if any runs failed
    return results.runsFailed > 0 ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    return 1;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}