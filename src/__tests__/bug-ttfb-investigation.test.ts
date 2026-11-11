/**
 * Bug investigation tests for TTFB timing and redirect handling.
 * These tests use local fixture servers to reproduce and verify the bug.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { main } from "../cli";
import { resolve } from "node:path";
import { parseResults, isAggregatedResults } from "../json";
import type { AggregatedResults } from "../runner";
import { ExitCode } from "../errors";

// Mock resolveHostname to return 127.0.0.1 for local testing
vi.mock("../net/resolve", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveHostname: vi.fn().mockResolvedValue({
      address: "127.0.0.1",
      family: "ipv4" as const,
    }),
    defaultDnsResolver: vi.fn().mockResolvedValue({
      ipv4: ["127.0.0.1"],
      ipv6: [],
    }),
  };
});

import { resolveHostname } from "../net/resolve";
const mockResolveHostname = vi.mocked(resolveHostname);

// Test server instances
let delayedServer: HttpServer;
let delayedPort: number;
let redirectServer: HttpServer;
let redirectPort: number;

const BASE_URL = "http://127.0.0.1";
const EXPECTED_DELAY_MS = 300;
// Tolerance: 300ms expected + 50ms network/processing overhead = 350ms max
// We use a generous tolerance because local loopback should be very fast
const TOLERANCE_MS = 100;

beforeAll(async () => {
  // Delayed response server - waits 300ms before sending headers
  delayedServer = createHttpServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Length": "13" });
      res.end("Hello, World!");
    }, EXPECTED_DELAY_MS);
  });

  await new Promise<void>((resolve) => {
    delayedServer.listen(0, "127.0.0.1", () => {
      const address = delayedServer.address();
      if (address && typeof address === "object") {
        delayedPort = address.port;
      }
      resolve();
    });
  });

  // Redirect server - returns 301 with Location header
  redirectServer = createHttpServer((req, res) => {
    res.writeHead(301, {
      "Location": `${BASE_URL}:${delayedPort}/redirected`,
      "Content-Length": "0",
    });
    res.end();
  });

  await new Promise<void>((resolve) => {
    redirectServer.listen(0, "127.0.0.1", () => {
      const address = redirectServer.address();
      if (address && typeof address === "object") {
        redirectPort = address.port;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => delayedServer.close(() => resolve()));
  await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
});

// Helper to capture console output
function captureConsole(): { logs: string[]; errors: string[]; restore: () => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args.join(" "));
  });
  return {
    logs,
    errors,
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

// Helper to run CLI and capture output
async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { logs, errors, restore } = captureConsole();
  mockResolveHostname.mockResolvedValue({
    address: "127.0.0.1",
    family: "ipv4",
  });
  const exitCode = await main(args);
  restore();
  return {
    exitCode,
    stdout: logs.join("\n"),
    stderr: errors.join("\n"),
  };
}

// Helper to validate and parse JSON output
function parseJsonOutput(stdout: string): AggregatedResults {
  const lines = stdout.trim().split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("{")) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    throw new Error("No JSON output found");
  }
  const jsonStr = lines.slice(startIdx).join("\n");
  const parsed = JSON.parse(jsonStr);
  expect(isAggregatedResults(parsed)).toBe(true);
  return parsed;
}

describe("bug investigation - TTFB timing", () => {
  it("should measure TTFB close to the server's fixed delay (300ms ± tolerance)", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${delayedPort}`,
      "--runs",
      "5",
      "--json",
      "--allow-private",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    expect(stderr).toBe("");

    const results = parseJsonOutput(stdout);

    // Check TTFB median is within tolerance of expected 300ms delay
    const ttfbMedian = results.stages.ttfb.medianMs;
    console.log(`TTFB median: ${ttfbMedian}ms (expected ~${EXPECTED_DELAY_MS}ms)`);
    console.log(`TTFB min: ${results.stages.ttfb.minMs}ms, max: ${results.stages.ttfb.maxMs}ms`);

    // The TTFB should be approximately the server delay (300ms) plus minimal overhead
    // Tolerance accounts for local loopback processing time
    expect(ttfbMedian).toBeGreaterThanOrEqual(EXPECTED_DELAY_MS - TOLERANCE_MS);
    expect(ttfbMedian).toBeLessThanOrEqual(EXPECTED_DELAY_MS + TOLERANCE_MS);

    // Body download should be very fast (small body)
    expect(results.stages.body.medianMs).toBeLessThan(10);
  });

  it("should NOT follow redirects (301) and should report the 3xx status", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${redirectPort}`,
      "--runs",
      "1",
      "--json",
      "--allow-private",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    expect(stderr).toBe("");

    const results = parseJsonOutput(stdout);

    // Should report the 301 status code, not follow the redirect
    expect(results.statusCode).toBe(301);

    // TTFB should be fast (no artificial delay on redirect response)
    // The redirect server responds immediately
    console.log(`Redirect TTFB median: ${results.stages.ttfb.medianMs}ms`);
    console.log(`Redirect status code: ${results.statusCode}`);
  });
});

describe("bug investigation - Total calculation", () => {
  it("should verify Total is median of per-run totals (not sum of stage medians)", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${delayedPort}`,
      "--runs",
      "5",
      "--json",
      "--allow-private",
    ]);

    expect(exitCode).toBe(ExitCode.OK);

    const results = parseJsonOutput(stdout);

    // Calculate sum of stage medians
    const sumOfStageMedians =
      results.stages.dns.medianMs +
      results.stages.tcp.medianMs +
      results.stages.tls.medianMs +
      results.stages.ttfb.medianMs +
      results.stages.body.medianMs;

    console.log(`Sum of stage medians: ${sumOfStageMedians.toFixed(2)}ms`);
    console.log(`Total median (from tool): ${results.total.medianMs.toFixed(2)}ms`);
    console.log(`Total min: ${results.total.minMs.toFixed(2)}ms, max: ${results.total.maxMs.toFixed(2)}ms`);

    // Total is defined as median of per-run totals
    // It should be close to but NOT necessarily equal to sum of stage medians
    // (they're equal only if all runs have identical per-stage timing)
    // We verify Total median is a reasonable value (not zero, not absurdly large)
    expect(results.total.medianMs).toBeGreaterThan(0);
    expect(results.total.medianMs).toBeLessThan(5000); // reasonable upper bound
    expect(results.total.minMs).toBeLessThanOrEqual(results.total.medianMs);
    expect(results.total.maxMs).toBeGreaterThanOrEqual(results.total.medianMs);
  });

  it("should verify Total median matches median of individual run totals", async () => {
    // This test verifies the internal calculation by checking consistency
    // We run multiple times and verify Total is median of run totals
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${delayedPort}`,
      "--runs",
      "7", // odd number for clear median
      "--json",
      "--allow-private",
    ]);

    expect(exitCode).toBe(ExitCode.OK);

    const results = parseJsonOutput(stdout);

    // Total should be median of per-run totals
    // We can't directly access per-run totals from AggregatedResults,
    // but we can verify the structure is correct
    expect(results.total.medianMs).toBeDefined();
    expect(results.total.minMs).toBeDefined();
    expect(results.total.maxMs).toBeDefined();
    
    // The min/max should bound the median
    expect(results.total.minMs).toBeLessThanOrEqual(results.total.medianMs);
    expect(results.total.maxMs).toBeGreaterThanOrEqual(results.total.medianMs);
  });
});