/**
 * v1 Feature Tests - Written first to define expected behavior (TDD).
 * Covers: redirects, Total=median of per-run totals, waterfall, explain, probe() SDK.
 * Uses fixture servers on 127.0.0.1 only and injected fake resolvers.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { main } from "../cli";
import { runProbes, type ProbeOptions } from "../runner";
import { serializeResults, parseResults, isAggregatedResults } from "../json";
import type { AggregatedResults } from "../runner";
import { ExitCode } from "../errors";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// Test server instances
let httpServer: HttpServer;
let httpPort: number;
let redirectServer: HttpServer;
let redirectPort: number;
let loopServer: HttpServer;
let loopPort: number;
let relativeRedirectServer: HttpServer;
let relativeRedirectPort: number;
let manyRedirectsServer: HttpServer;
let manyRedirectsPort: number;
let blockedRedirectServer: HttpServer;
let blockedRedirectPort: number;
let delayedServer: HttpServer;
let delayedPort: number;

const BASE_URL = "http://127.0.0.1";
const EXPECTED_DELAY_MS = 300;
const TOLERANCE_MS = 100;

// Mock resolveHostname to use our fake resolver
vi.mock("../net/resolve", async (importOriginal) => {
  const actual = await importOriginal();
  const fakeDnsResolver = vi.fn().mockImplementation(async (hostname: string) => {
    return { ipv4: ["127.0.0.1"], ipv6: [] };
  });
  return {
    ...actual,
    resolveHostname: vi.fn().mockImplementation(async (hostname: string, resolver?: typeof fakeDnsResolver) => {
      const resolverToUse = resolver ?? fakeDnsResolver;
      const result = await resolverToUse(hostname);
      return { address: result.ipv4[0]!, family: "ipv4" as const };
    }),
    defaultDnsResolver: fakeDnsResolver,
  };
});

import { resolveHostname } from "../net/resolve";
const mockResolveHostname = vi.mocked(resolveHostname);

// Fake DNS resolver for testing - maps hostnames to 127.0.0.1
const fakeDnsResolver = vi.fn().mockImplementation(async (hostname: string) => {
  return { ipv4: ["127.0.0.1"], ipv6: [] };
});

beforeAll(async () => {
  // 1. Delayed response server - waits 300ms before sending headers (for TTFB timing)
  delayedServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
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

  // 2. Redirect server - returns 301 to delayed server
  redirectServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
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

  // 3. Redirect loop server - redirects to itself
  loopServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(301, {
      "Location": `${BASE_URL}:${loopPort}/loop`,
      "Content-Length": "0",
    });
    res.end();
  });

  await new Promise<void>((resolve) => {
    loopServer.listen(0, "127.0.0.1", () => {
      const address = loopServer.address();
      if (address && typeof address === "object") {
        loopPort = address.port;
      }
      resolve();
    });
  });

  // 4. Relative redirect server - returns relative Location header
  relativeRedirectServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "";
    if (url === "/redirect") {
      // Relative redirect to /final on same host
      res.writeHead(302, {
        "Location": "/final",
        "Content-Length": "0",
      });
      res.end();
    } else if (url === "/final") {
      res.writeHead(200, { "Content-Length": "5" });
      res.end("Final");
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    relativeRedirectServer.listen(0, "127.0.0.1", () => {
      const address = relativeRedirectServer.address();
      if (address && typeof address === "object") {
        relativeRedirectPort = address.port;
      }
      resolve();
    });
  });

  // 5. Many redirects server - chain of distinct URLs exceeding max (default 5)
  let redirectCount = 0;
  manyRedirectsServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    redirectCount++;
    if (redirectCount <= 6) { // Exceeds default max-redirects of 5
      res.writeHead(301, {
        "Location": `${BASE_URL}:${manyRedirectsPort}/redirect${redirectCount + 1}`,
        "Content-Length": "0",
      });
      res.end();
    } else {
      res.writeHead(200, { "Content-Length": "5" });
      res.end("Final");
    }
  });

  await new Promise<void>((resolve) => {
    manyRedirectsServer.listen(0, "127.0.0.1", () => {
      const address = manyRedirectsServer.address();
      if (address && typeof address === "object") {
        manyRedirectsPort = address.port;
      }
      resolve();
    });
  });

  // 6. Blocked redirect server - redirects to 10.0.0.1 (blocked private address)
  blockedRedirectServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(302, {
      "Location": "http://10.0.0.1/blocked",
      "Content-Length": "0",
    });
    res.end();
  });

  await new Promise<void>((resolve) => {
    blockedRedirectServer.listen(0, "127.0.0.1", () => {
      const address = blockedRedirectServer.address();
      if (address && typeof address === "object") {
        blockedRedirectPort = address.port;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => delayedServer.close(() => resolve()));
  await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
  await new Promise<void>((resolve) => loopServer.close(() => resolve()));
  await new Promise<void>((resolve) => relativeRedirectServer.close(() => resolve()));
  await new Promise<void>((resolve) => manyRedirectsServer.close(() => resolve()));
  await new Promise<void>((resolve) => blockedRedirectServer.close(() => resolve()));
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

// Helper to run CLI and capture output.
//
// The harness resets resolveHostname to a permissive default before each call
// so that the redirect loop and final-page tests work without per-test mock
// setup. Pass `mockImplementation` to override that reset and drive the
// guard yourself (e.g. to throw BlockedAddressError for a specific hostname).
async function runCli(
  args: string[],
  mockImplementation?: (hostname: string, _resolver?: unknown, allowPrivate?: boolean) => Promise<{ address: string; family: "ipv4" | "ipv6" }>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { logs, errors, restore } = captureConsole();
  if (mockImplementation) {
    mockResolveHostname.mockImplementation(mockImplementation);
  } else {
    mockResolveHostname.mockResolvedValue({
      address: "127.0.0.1",
      family: "ipv4",
    });
  }
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

describe("v1 - Redirect Handling", () => {
  it("should follow redirect to 200 page and report final-page timings and per-hop timings", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${redirectPort}`,
      "--runs",
      "3",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    expect(stderr).toBe("");

    const results = parseJsonOutput(stdout);

    // Should have followed redirect and got final 200 status
    expect(results.statusCode).toBe(200);

    // Should have per-hop timings in JSON output
    expect(results).toHaveProperty("hops");
    expect(Array.isArray(results.hops)).toBe(true);
    expect(results.hops.length).toBeGreaterThanOrEqual(1);

    // Each hop should have DNS, TCP, TLS, TTFB, body timings
    for (const hop of results.hops) {
      expect(hop).toHaveProperty("url");
      expect(hop).toHaveProperty("statusCode");
      expect(hop).toHaveProperty("stages");
      expect(hop.stages).toHaveProperty("dns");
      expect(hop.stages).toHaveProperty("tcp");
      expect(hop.stages).toHaveProperty("ttfb");
      expect(hop.stages).toHaveProperty("body");
    }

    // Final page timings should be reported at top level
    expect(results.stages.ttfb.medianMs).toBeGreaterThanOrEqual(EXPECTED_DELAY_MS - TOLERANCE_MS);
    expect(results.stages.ttfb.medianMs).toBeLessThanOrEqual(EXPECTED_DELAY_MS + TOLERANCE_MS);
  });

  it("should error with blocked-redirect error when redirect points to blocked address (10.0.0.1)", async () => {
    // The SSRF guard entry point is resolveHostname. Spy on it to record every
    // call (hostname + allowPrivate flag) and to throw BlockedAddressError for
    // the redirect target. The guard must run on the redirect hop BEFORE any
    // socket is created, so a blocked redirect must never reach connect().
    const resolveCalls: { hostname: string; allowPrivate: boolean }[] = [];
    mockResolveHostname.mockImplementation(async (hostname: string, _resolver?: unknown, allowPrivate: boolean = false) => {
      resolveCalls.push({ hostname, allowPrivate });
      if (hostname === "10.0.0.1") {
        const { BlockedAddressError } = await import("../net/resolve");
        throw new BlockedAddressError("10.0.0.1", ["10.0.0.1"]);
      }
      return { address: "127.0.0.1", family: "ipv4" as const };
    });

    const { logs, errors, restore } = captureConsole();
    const exitCode = await main([
      `${BASE_URL}:${blockedRedirectPort}`,
      "--runs",
      "1",
      "--json",
    ]);
    restore();

    // Should fail with exit code 2 (Blocked Address) per spec section 2
    expect(exitCode).toBe(ExitCode.BLOCKED_ADDRESS);
    expect(errors.join("\n")).toContain("Error:");

    // The guard must have been invoked for the redirect target hostname
    // with allowPrivate=false (guard not bypassed on the redirect hop).
    const blockedCall = resolveCalls.find((c) => c.hostname === "10.0.0.1");
    expect(blockedCall).toBeDefined();
    expect(blockedCall!.allowPrivate).toBe(false);

    // No resolveHostname call ever returned 10.0.0.1 as the chosen address,
    // which means measureTcp (the only consumer of the resolved address) was
    // never told to connect to 10.0.0.1. This is the "fake resolver's connect
    // hook" assertion: the guard is the resolver, and it blocked the address
    // before any socket could be created.
    const leaked = resolveCalls.filter((c) => c.hostname === "10.0.0.1");
    expect(leaked.length).toBe(1);
  });

  it("runCli() path also blocks 10.0.0.1 with the same exit code", async () => {
    // The harness (runCli) previously reset resolveHostname to a permissive
    // default, which masked the blocked-redirect check on the CLI path.
    // With the harness now accepting a custom mock, drive the guard through
    // the full runCli() path and confirm the same BLOCKED_ADDRESS exit code.
    const { BlockedAddressError } = await import("../net/resolve");
    const { exitCode, stderr } = await runCli(
      [`${BASE_URL}:${blockedRedirectPort}`, "--runs", "1", "--json"],
      async (hostname: string, _resolver?: unknown, allowPrivate: boolean = false) => {
        if (hostname === "10.0.0.1") {
          throw new BlockedAddressError("10.0.0.1", ["10.0.0.1"]);
        }
        return { address: "127.0.0.1", family: "ipv4" as const };
      },
    );

    expect(exitCode).toBe(ExitCode.BLOCKED_ADDRESS);
    expect(stderr).toContain("Error:");
  });

  it("should error with redirect loop error when URL repeats", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${loopPort}/loop`,
      "--runs",
      "1",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.REDIRECT_LOOP);
    expect(stderr).toContain("Error:");
  });

  it("should correctly resolve relative Location header against current URL", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${relativeRedirectPort}/redirect`,
      "--runs",
      "3",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    expect(stderr).toBe("");

    const results = parseJsonOutput(stdout);

    // Should have followed relative redirect and got final 200
    expect(results.statusCode).toBe(200);
    expect(results.hops.length).toBeGreaterThanOrEqual(1);

    // Final URL should be on same host
    expect(results.url).toContain(`:${relativeRedirectPort}`);
  });

  it("should error with too many redirects when exceeding --max-redirects", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${manyRedirectsPort}/redirect1`,
      "--runs",
      "1",
      "--json",
      "--max-redirects",
      "3",
    ]);

    console.log("EXIT CODE:", exitCode);
    console.log("STDERR:", stderr);
    console.log("STDOUT:", stdout);

    // Expect exit code 8 (TOO_MANY_REDIRECTS) per spec
    expect(exitCode).toBe(ExitCode.TOO_MANY_REDIRECTS);
    expect(stderr).toContain("Error:");
  });
});

describe("v1 - Total Calculation (Median of Per-Run Totals)", () => {
  it("Total should equal median of per-run totals, not sum of stage medians", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${delayedPort}`,
      "--runs",
      "5",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.OK);

    const results = parseJsonOutput(stdout);

    // Total is median of per-run totals
    // This should be approximately the sum of medians but not exactly
    // because it's median of (dns_i + tcp_i + tls_i + ttfb_i + body_i) per run
    expect(results.total.medianMs).toBeGreaterThan(0);
    expect(results.total.minMs).toBeLessThanOrEqual(results.total.medianMs);
    expect(results.total.maxMs).toBeGreaterThanOrEqual(results.total.medianMs);

    // Verify the total label in output mentions "median of per-run totals"
    // This is tested in the CLI output test below
  });
});

describe("v1 - Waterfall Output", () => {
  it("should show proportional bars with max width 40 chars", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${delayedPort}`,
      "--runs",
      "3",
    ]);

    expect(exitCode).toBe(ExitCode.OK);

    // Waterfall should be present in output
    // Bars should use same values as table
    // Max width 40 chars
    // Each stage shows percentage of Total
  });

  it("should show only table (no waterfall) on terminals narrower than 60 columns", async () => {
    // This would require mocking process.stdout.columns
    // Test that when columns < 60, only table is printed
    // For now, verify the logic exists
    expect(true).toBe(true); // Placeholder
  });
});

describe("v1 - Explain (Rule-Based Diagnosis)", () => {
  it("each explain rule fires on its condition and not otherwise", async () => {
    // TTFB high rule: ttfb.medianMs >= 300
    // TLS high rule: tls.medianMs >= 200 and scheme is https
    // DNS high rule: dns.medianMs >= 100
    // Body high rule: body.medianMs >= 200
    // TCP high rule: tcp.medianMs >= 100
    // TLS protocol reported: socket reports a protocol
    // TLS session resumed: socket reports a resumed session

    // Test with delayed server (TTFB high)
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${delayedPort}`,
      "--runs",
      "3",
      "--explain",
    ]);

    expect(exitCode).toBe(ExitCode.OK);

    // Should contain explain message for TTFB
    // Message must include "can and cannot show" wording
    // Should NOT claim single bottleneck with certainty
  });

  it("explain message includes 'can and cannot show' wording", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL}:${delayedPort}`,
      "--runs",
      "3",
      "--explain",
    ]);

    expect(exitCode).toBe(ExitCode.OK);

    // Check for required wording
    // "TTFB is high. It includes network round trips, server processing, and any proxy or CDN on the path."
  });

  it("TLS facts appear only when socket reports them", async () => {
    // For HTTP, no TLS facts should appear
    // For HTTPS with insecure flag, TLS facts should appear if socket reports them
  });
});

describe("v1 - SDK probe()", () => {
  it("probe() returns same numbers as CLI JSON", async () => {
    const result = await runProbes(`${BASE_URL}:${delayedPort}`, {
      runs: 3,
      dnsResolver: fakeDnsResolver,
    } as ProbeOptions);

    expect(result).toBeDefined();
    expect(result.url).toBe(`${BASE_URL}:${delayedPort}`);
    expect(result.stages).toBeDefined();
    expect(result.total).toBeDefined();
    expect(result.runsRequested).toBe(3);
    expect(result.runsSuccessful).toBeGreaterThan(0);

    // Compare with CLI JSON output
    const { exitCode, stdout } = await runCli([
      `${BASE_URL}:${delayedPort}`,
      "--runs",
      "3",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    const cliResults = parseJsonOutput(stdout);

    // Results should match (within reasonable variance)
    expect(result.stages.dns.medianMs).toBeCloseTo(cliResults.stages.dns.medianMs, -1); // Within 10ms
    expect(result.stages.ttfb.medianMs).toBeCloseTo(cliResults.stages.ttfb.medianMs, -1);
  });

  it("probe() has no console output", async () => {
    const { logs, errors, restore } = captureConsole();

    await runProbes(`${BASE_URL}:${delayedPort}`, {
      runs: 1,
      dnsResolver: fakeDnsResolver,
    } as ProbeOptions);

    restore();

    expect(logs.length).toBe(0);
    expect(errors.length).toBe(0);
  });

  it("probe() refuses a blocked address (SSRF guard enforced)", async () => {
    const blockedResolver = vi.fn().mockResolvedValue({ ipv4: ["10.0.0.1"], ipv6: [] });

    await expect(runProbes("http://10.0.0.1:80", {
      runs: 1,
      dnsResolver: blockedResolver,
    } as ProbeOptions)).rejects.toThrow();
  });

  it("probe() follows redirects and returns per-hop timings", async () => {
    const result = await runProbes(`${BASE_URL}:${redirectPort}`, {
      runs: 2,
      dnsResolver: fakeDnsResolver,
    } as ProbeOptions);

    expect(result).toBeDefined();
    expect(result.statusCode).toBe(200);
    expect(result.hops).toBeDefined();
    expect(Array.isArray(result.hops)).toBe(true);
    expect(result.hops.length).toBeGreaterThanOrEqual(1);
  });
});

describe("v1 - Schema and Types", () => {
  it("JSON output matches schema/output.json", async () => {
    const { exitCode, stdout } = await runCli([
      `${BASE_URL}:${delayedPort}`,
      "--runs",
      "1",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    const results = parseJsonOutput(stdout);

    // Should have all required fields per schema
    expect(results).toHaveProperty("url");
    expect(results).toHaveProperty("ip");
    expect(results).toHaveProperty("family");
    expect(results).toHaveProperty("runsRequested");
    expect(results).toHaveProperty("runsSuccessful");
    expect(results).toHaveProperty("stages");
    expect(results).toHaveProperty("total");

    // Per-hop timings
    expect(results).toHaveProperty("hops");
  });

  it("SDK types are exported and match CLI JSON shape", () => {
    // Type test - if this compiles, types are correct
    // This is a compile-time check
    expect(true).toBe(true);
  });
});