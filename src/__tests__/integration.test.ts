/**
 * End-to-end integration tests for Network Atonomy CLI.
 *
 * Spins up local HTTP/HTTPS test servers, runs CLI against them with various
 * flag combinations, and verifies output matches expected format and timing
 * values are plausible. Tests both human-readable and JSON output.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { main } from "../cli";
import { serializeResults, parseResults, isAggregatedResults } from "../json";
import type { AggregatedResults } from "../runner";
import { ExitCode } from "../errors";

// Integration tests need longer timeout (server startup + multiple probe runs)
vi.setConfig({ testTimeout: 30000 });

// Test server instances
let httpServer: HttpServer;
let httpPort: number;
let httpsServer: HttpsServer;
let httpsPort: number;

const TEST_RUNS = 3;
const BASE_URL_HTTP = "http://localhost";
const BASE_URL_HTTPS = "https://localhost";

// Mock resolveHostname and measureTcp/measureTls/measureHttp or inject resolver
// Since we want to test CLI against local servers without SSRF blocking 127.0.0.1,
// we can mock resolveHostname to return 127.0.0.1 and use custom port in URL or mock measureTcp.
// Wait, if resolveHostname returns 127.0.0.1, SSRF guard will block it!
// But we are allowed to touch src/__tests__/integration.test.ts and src/fixtures/.
// Let's check allowed files: src/__tests__/integration.test.ts, src/fixtures/.
// We CANNOT touch src/net/resolve.ts or src/stages/ or src/runner.ts or src/cli.ts.
// How does measureTcp connect? It connects to `address` (resolved IP) and `port` (from URL).
// If URL is `http://localhost:PORT`, `validateUrl` parses hostname="localhost", port=PORT.
// Then `resolveHostname("localhost")` resolves to an IP.
// If we mock `resolveHostname` to return `{ address: "127.0.0.1", family: "ipv4" }`,
// does SSRF guard block it? `resolveHostname` calls `checkAddressBlocked(127.0.0.1)`, which throws `BlockedAddressError`!
// Wait! Can we mock `resolveHostname` entirely using `vi.mock` in `integration.test.ts`?
// Yes! `resolveHostname` is in `../net/resolve`. We can mock `../net/resolve` in `integration.test.ts`!

vi.mock("../net/resolve", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveHostname: vi.fn().mockImplementation(async (hostname) => {
      return {
        address: "127.0.0.1",
        family: "ipv4" as const,
      };
    }),
    defaultDnsResolver: vi.fn().mockResolvedValue({
      ipv4: ["127.0.0.1"],
      ipv6: [],
    }),
  };
});

import { resolveHostname } from "../net/resolve";
const mockResolveHostname = vi.mocked(resolveHostname);

beforeAll(async () => {
  // HTTP server
  httpServer = createHttpServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Length": "13" });
      res.end("Hello, World!");
    }, 10);
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      if (address && typeof address === "object") {
        httpPort = address.port;
      }
      resolve();
    });
  });

  // HTTPS server with self-signed cert from fixtures
  const certPath = resolve(__dirname, "../fixtures/localhost-cert.pem");
  const keyPath = resolve(__dirname, "../fixtures/localhost-key.pem");
  const cert = readFileSync(certPath, "utf8");
  const key = readFileSync(keyPath, "utf8");

  httpsServer = createHttpsServer({ cert, key }, (req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Length": "13" });
      res.end("Hello, World!");
    }, 10);
  });

  await new Promise<void>((resolve) => {
    httpsServer.listen(0, "127.0.0.1", () => {
      const address = httpsServer.address();
      if (address && typeof address === "object") {
        httpsPort = address.port;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
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

// Helper to validate aggregated results structure
function validateAggregatedResults(results: AggregatedResults): void {
  expect(results).toHaveProperty("stages");
  expect(results).toHaveProperty("total");
  expect(results).toHaveProperty("runsRequested");
  expect(results).toHaveProperty("runsSuccessful");
  expect(results).toHaveProperty("runsFailed");
  expect(results).toHaveProperty("url");
  expect(results).toHaveProperty("ip");
  expect(results).toHaveProperty("family");
  expect(results).toHaveProperty("warnings");

  const stages = results.stages;
  expect(stages).toHaveProperty("dns");
  expect(stages).toHaveProperty("tcp");
  expect(stages).toHaveProperty("tls");
  expect(stages).toHaveProperty("ttfb");
  expect(stages).toHaveProperty("body");

  for (const stage of ["dns", "tcp", "tls", "ttfb", "body"] as const) {
    expect(stages[stage]).toHaveProperty("medianMs");
    expect(stages[stage]).toHaveProperty("minMs");
    expect(stages[stage]).toHaveProperty("maxMs");
    expect(typeof stages[stage].medianMs).toBe("number");
    expect(typeof stages[stage].minMs).toBe("number");
    expect(typeof stages[stage].maxMs).toBe("number");
    expect(stages[stage].medianMs).toBeGreaterThanOrEqual(0);
    expect(stages[stage].minMs).toBeGreaterThanOrEqual(0);
    expect(stages[stage].maxMs).toBeGreaterThanOrEqual(0);
    expect(stages[stage].minMs).toBeLessThanOrEqual(stages[stage].medianMs);
    expect(stages[stage].medianMs).toBeLessThanOrEqual(stages[stage].maxMs);
  }

  expect(results.total).toHaveProperty("medianMs");
  expect(results.total).toHaveProperty("minMs");
  expect(results.total).toHaveProperty("maxMs");
  expect(results.runsRequested).toBeGreaterThan(0);
  expect(results.runsSuccessful).toBeGreaterThan(0);
  expect(results.runsSuccessful).toBeLessThanOrEqual(results.runsRequested);
  expect(results.runsFailed).toBeGreaterThanOrEqual(0);
  expect(results.runsSuccessful + results.runsFailed).toBe(results.runsRequested);

  expect(typeof results.url).toBe("string");
  expect(results.url).toMatch(/^https?:\/\//);
  expect(typeof results.ip).toBe("string");
  expect(results.ip).toBe("127.0.0.1");
  expect(["IPv4", "IPv6"]).toContain(results.family);
  expect(Array.isArray(results.warnings)).toBe(true);
}

// Helper to validate plausible timing values
function validatePlausibleTimings(results: AggregatedResults, scheme: "http" | "https"): void {
  const stages = results.stages;

  expect(stages.dns.medianMs).toBeGreaterThan(0);
  expect(stages.dns.medianMs).toBeLessThan(100);

  expect(stages.tcp.medianMs).toBeGreaterThan(0);
  expect(stages.tcp.medianMs).toBeLessThan(100);

  if (scheme === "https") {
    expect(stages.tls.medianMs).toBeGreaterThan(0);
    expect(stages.tls.medianMs).toBeLessThan(500);
  } else {
    expect(stages.tls.medianMs).toBeGreaterThanOrEqual(0);
    expect(stages.tls.medianMs).toBeLessThan(10);
  }

  // TTFB can be higher in test environments (CI, mocked DNS, etc.)
  expect(stages.ttfb.medianMs).toBeGreaterThan(5);
  expect(stages.ttfb.medianMs).toBeLessThan(2000);

  expect(stages.body.medianMs).toBeGreaterThanOrEqual(0);
  expect(stages.body.medianMs).toBeLessThan(100);

  const sumOfMedians =
    stages.dns.medianMs + stages.tcp.medianMs + stages.tls.medianMs + stages.ttfb.medianMs + stages.body.medianMs;
  expect(results.total.medianMs).toBeGreaterThan(sumOfMedians * 0.5);
  expect(results.total.medianMs).toBeLessThan(sumOfMedians * 2 + 100);
}

// Helper to validate human-readable output format
function validateHumanReadableOutput(stdout: string): void {
  expect(stdout).toContain("Target:");
  expect(stdout).toContain("Runs:");
  expect(stdout).toContain("Stage");
  expect(stdout).toContain("Median");
  expect(stdout).toContain("Min");
  expect(stdout).toContain("Max");
  expect(stdout).toContain("DNS Lookup");
  expect(stdout).toContain("TCP Connect");
  expect(stdout).toContain("TLS Handshake");
  expect(stdout).toContain("TTFB");
  expect(stdout).toContain("Body Download");
  expect(stdout).toContain("Total");
  expect(stdout).toMatch(/\d+\.\d{2}\s*ms/);
}

// Helper to validate JSON output
function validateJsonOutput(stdout: string): AggregatedResults {
  const lines = stdout.trim().split("\n");
  // JSON output may be pretty-printed (multiple lines), so find first line with {
  // and join all remaining lines
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
  // Debug
  console.log("DEBUG JSON validateJsonOutput:", { jsonStr });
  expect(jsonStr).toBeTruthy();

  let parsed: AggregatedResults;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse JSON output: ${e}`);
  }

  expect(isAggregatedResults(parsed)).toBe(true);
  validateAggregatedResults(parsed);

  return parsed;
}

describe("integration - HTTP server", () => {
  describe("human-readable output", () => {
    it("runs with default options and produces valid output", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        String(TEST_RUNS),
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      expect(stderr).toBe("");
      validateHumanReadableOutput(stdout);
    });

    it("runs with --runs and --concurrency options", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        "4",
        "--concurrency",
        "2",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      expect(stderr).toBe("");
      validateHumanReadableOutput(stdout);
    });

    it("runs with --delay option", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        "2",
        "--delay",
        "50",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      expect(stderr).toBe("");
      validateHumanReadableOutput(stdout);
    });

    it("runs with --max-body option", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        "1",
        "--max-body",
        "1024",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      expect(stderr).toBe("");
      validateHumanReadableOutput(stdout);
    });

    it("runs with --timeout option (single value)", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        "1",
        "--timeout",
        "5000",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      expect(stderr).toBe("");
      validateHumanReadableOutput(stdout);
    });

    it("runs with --timeout option (per-stage values)", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        "1",
        "--timeout",
        "dns=1000,tcp=2000,ttfb=3000",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      expect(stderr).toBe("");
      validateHumanReadableOutput(stdout);
    });
  });

  describe("JSON output", () => {
    it("produces valid JSON with --json flag", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        String(TEST_RUNS),
        "--json",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      expect(stderr).toBe("");
      const results = validateJsonOutput(stdout);

      validateAggregatedResults(results);
      validatePlausibleTimings(results, "http");

      expect(results.runsRequested).toBe(TEST_RUNS);
      expect(results.runsSuccessful).toBe(TEST_RUNS);
      expect(results.runsFailed).toBe(0);
      expect(results.url).toBe(`${BASE_URL_HTTP}:${httpPort}`);
      expect(results.ip).toBe("127.0.0.1");
      expect(results.family).toBe("IPv4");
    });

    it("produces valid JSON with --json and --concurrency", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        "4",
        "--concurrency",
        "2",
        "--json",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      const results = validateJsonOutput(stdout);
      validatePlausibleTimings(results, "http");
      expect(results.runsRequested).toBe(4);
      expect(results.runsSuccessful).toBe(4);
    });

    it("JSON output is parseable by parseResults", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        "1",
        "--json",
        "--allow-private",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      // Extract JSON the same way as validateJsonOutput
      const lines = stdout.trim().split("\n");
      let startIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith("{")) {
          startIdx = i;
          break;
        }
      }
      const jsonStr = lines.slice(startIdx).join("\n");
      const parsed = parseResults(jsonStr);
      expect(parsed.runsRequested).toBe(1);
      expect(parsed.url).toBe(`${BASE_URL_HTTP}:${httpPort}`);
    });
  });

  describe("timing validation", () => {
    it("produces plausible timing values for HTTP", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        "3",
        "--json",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      const results = validateJsonOutput(stdout);
      validatePlausibleTimings(results, "http");
    });

    it("median <= max and min <= median for all stages", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTP}:${httpPort}`,
        "--runs",
        "3",
        "--json",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      const results = validateJsonOutput(stdout);

      for (const stage of ["dns", "tcp", "tls", "ttfb", "body"] as const) {
        expect(results.stages[stage].minMs).toBeLessThanOrEqual(results.stages[stage].medianMs);
        expect(results.stages[stage].medianMs).toBeLessThanOrEqual(results.stages[stage].maxMs);
      }
      expect(results.total.minMs).toBeLessThanOrEqual(results.total.medianMs);
      expect(results.total.medianMs).toBeLessThanOrEqual(results.total.maxMs);
    });
  });
});

describe("integration - HTTPS server", () => {
  describe("human-readable output", () => {
    it("runs with default options and produces valid output", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTPS}:${httpsPort}`,
        "--runs",
        String(TEST_RUNS),
        "--insecure",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      expect(stderr).toBe("");
      validateHumanReadableOutput(stdout);
    });

    it("runs with --runs and --concurrency options", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTPS}:${httpsPort}`,
        "--runs",
        "4",
        "--concurrency",
        "2",
        "--insecure",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      expect(stderr).toBe("");
      validateHumanReadableOutput(stdout);
    });
  });

  describe("JSON output", () => {
    it("produces valid JSON with --json flag", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTPS}:${httpsPort}`,
        "--runs",
        String(TEST_RUNS),
        "--json",
        "--insecure",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      expect(stderr).toBe("");
      const results = validateJsonOutput(stdout);

      validateAggregatedResults(results);
      validatePlausibleTimings(results, "https");

      expect(results.runsRequested).toBe(TEST_RUNS);
      expect(results.runsSuccessful).toBe(TEST_RUNS);
      expect(results.runsFailed).toBe(0);
      expect(results.url).toBe(`${BASE_URL_HTTPS}:${httpsPort}`);
      expect(results.ip).toBe("127.0.0.1");
      expect(results.family).toBe("IPv4");
    });

    it("TLS timing is non-zero for HTTPS", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTPS}:${httpsPort}`,
        "--runs",
        "3",
        "--json",
        "--insecure",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      const results = validateJsonOutput(stdout);
      expect(results.stages.tls.medianMs).toBeGreaterThan(0);
      expect(results.stages.tls.medianMs).toBeLessThan(500);
    });
  });

  describe("timing validation", () => {
    it("produces plausible timing values for HTTPS", async () => {
      const { exitCode, stdout, stderr } = await runCli([
        `${BASE_URL_HTTPS}:${httpsPort}`,
        "--runs",
        "3",
        "--json",
        "--insecure",
      ]);

      expect(exitCode).toBe(ExitCode.OK);
      const results = validateJsonOutput(stdout);
      validatePlausibleTimings(results, "https");
    });
  });
});

describe("integration - flag combinations", () => {
  it("works with --runs 1 --json --insecure (minimal)", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL_HTTPS}:${httpsPort}`,
      "--runs",
      "1",
      "--json",
      "--insecure",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    const results = validateJsonOutput(stdout);
    expect(results.runsRequested).toBe(1);
    expect(results.runsSuccessful).toBe(1);
  });

  it("works with --runs 5 --concurrency 3 --delay 100 --max-body 512 --timeout 2000 --json", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL_HTTP}:${httpPort}`,
      "--runs",
      "5",
      "--concurrency",
      "3",
      "--delay",
      "100",
      "--max-body",
      "512",
      "--timeout",
      "2000",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    const results = validateJsonOutput(stdout);
    expect(results.runsRequested).toBe(5);
    expect(results.runsSuccessful).toBe(5);
    validatePlausibleTimings(results, "http");
  });

  it("works with per-stage timeout --json", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL_HTTP}:${httpPort}`,
      "--runs",
      "2",
      "--timeout",
      "dns=500,tcp=1000,tls=1500,ttfb=3000,body=2000",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    const results = validateJsonOutput(stdout);
    validatePlausibleTimings(results, "http");
  });
});

describe("integration - output format validation", () => {
  it("human-readable output contains all stage rows", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL_HTTP}:${httpPort}`,
      "--runs",
      "1",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    expect(stdout).toContain("DNS Lookup");
    expect(stdout).toContain("TCP Connect");
    expect(stdout).toContain("TLS Handshake");
    expect(stdout).toContain("TTFB");
    expect(stdout).toContain("Body Download");
    expect(stdout).toContain("Total");
  });

  it("JSON output contains all required fields per schema", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL_HTTP}:${httpPort}`,
      "--runs",
      "1",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    const results = validateJsonOutput(stdout);

    expect(results).toHaveProperty("stages");
    expect(results.stages).toHaveProperty("dns");
    expect(results.stages).toHaveProperty("tcp");
    expect(results.stages).toHaveProperty("tls");
    expect(results.stages).toHaveProperty("ttfb");
    expect(results.stages).toHaveProperty("body");
    // total is at top level, not inside stages
    expect(results).toHaveProperty("total");
    expect(results).toHaveProperty("runsRequested");
    expect(results).toHaveProperty("runsSuccessful");
    expect(results).toHaveProperty("runsFailed");
    expect(results).toHaveProperty("url");
    expect(results).toHaveProperty("ip");
    expect(results).toHaveProperty("family");
    expect(results).toHaveProperty("warnings");
  });

  it("JSON output values are numbers (not strings)", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL_HTTP}:${httpPort}`,
      "--runs",
      "1",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    const results = validateJsonOutput(stdout);

    expect(typeof results.stages.dns.medianMs).toBe("number");
    expect(typeof results.stages.tcp.medianMs).toBe("number");
    expect(typeof results.stages.tls.medianMs).toBe("number");
    expect(typeof results.stages.ttfb.medianMs).toBe("number");
    expect(typeof results.stages.body.medianMs).toBe("number");
    expect(typeof results.total.medianMs).toBe("number");
    expect(typeof results.runsRequested).toBe("number");
    expect(typeof results.runsSuccessful).toBe("number");
    expect(typeof results.runsFailed).toBe("number");
  });

  it("JSON output can be serialized back and forth", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      `${BASE_URL_HTTP}:${httpPort}`,
      "--runs",
      "1",
      "--json",
    ]);

    expect(exitCode).toBe(ExitCode.OK);
    const results = validateJsonOutput(stdout);

    const serialized = serializeResults(results, { pretty: true });
    const reparsed = parseResults(serialized);
    expect(reparsed).toEqual(results);
  });
});

describe("integration - error handling with local servers", () => {
  it("returns non-zero exit code for invalid URL", async () => {
    const { exitCode, stdout, stderr } = await runCli(["not-a-url"]);

    expect(exitCode).toBe(ExitCode.INVALID_ARGS);
    expect(stderr).toContain("Error:");
  });

  it("handles connection refused gracefully", async () => {
    // Mock resolveHostname to return 127.0.0.1 for port 1 (connection refused)
    mockResolveHostname.mockResolvedValue({
      address: "127.0.0.1",
      family: "ipv4",
    });

    const { exitCode, stdout, stderr } = await runCli([
      "http://localhost:1",
      "--runs",
      "1",
    ]);

    expect(exitCode).toBe(ExitCode.TCP_FAILED);
    expect(stderr).toContain("Error:");
  });
});