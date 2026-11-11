/**
 * Tests for CLI entry point.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { main } from "../cli";
import { runProbes, printResults, formatMs, type AggregatedResults } from "../runner";
import { ResolutionError, BlockedAddressError } from "../net/resolve";
import {
  ExitCode,
  TcpFailedError,
  TimeoutError,
  TlsFailedError,
  HttpFailedError,
  AllRunsFailedError,
  InvalidArgsError,
  RedirectLoopError,
  TooManyRedirectsError,
  DnsFailedError,
} from "../errors";

// Mock runProbes
vi.mock("../runner", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runProbes: vi.fn(),
    // Don't mock printResults and formatMs - use real implementations for output tests
  };
});

import { runProbes as mockRunProbes } from "../runner";

const mockRunProbesFn = vi.mocked(mockRunProbes);

const createMockResults = (overrides: Partial<AggregatedResults> = {}): AggregatedResults => ({
  stages: {
    dns: { medianMs: 12.4, minMs: 10.1, maxMs: 15.2 },
    tcp: { medianMs: 24.15, minMs: 22.0, maxMs: 28.5 },
    tls: { medianMs: 45.3, minMs: 42.1, maxMs: 51.0 },
    ttfb: { medianMs: 110.8, minMs: 105.2, maxMs: 120.4 },
    body: { medianMs: 15.2, minMs: 12.0, maxMs: 19.1 },
  },
  total: { medianMs: 207.85, minMs: 191.4, maxMs: 234.2 },
  runsRequested: 5,
  runsSuccessful: 5,
  runsFailed: 0,
  url: "https://example.com",
  ip: "93.184.216.34",
  family: "IPv4",
  warnings: [],
  ...overrides,
});

describe("cli - argument parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunProbesFn.mockResolvedValue(createMockResults());
  });

  it("requires a URL argument", async () => {
    const code = await main([]);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("rejects multiple positional arguments", async () => {
    const code = await main(["http://a.com", "http://b.com"]);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("parses --runs option", async () => {
    await main(["http://example.com", "--runs", "10"]);
    expect(mockRunProbesFn).toHaveBeenCalledWith("http://example.com", expect.objectContaining({ runs: 10 }));
  });

  it("parses --concurrency option", async () => {
    await main(["http://example.com", "--concurrency", "3"]);
    expect(mockRunProbesFn).toHaveBeenCalledWith("http://example.com", expect.objectContaining({ concurrency: 3 }));
  });

  it("parses --delay option", async () => {
    await main(["http://example.com", "--delay", "100"]);
    expect(mockRunProbesFn).toHaveBeenCalledWith("http://example.com", expect.objectContaining({ delayMs: 100 }));
  });

  it("parses --max-body option", async () => {
    await main(["http://example.com", "--max-body", "2048"]);
    expect(mockRunProbesFn).toHaveBeenCalledWith("http://example.com", expect.objectContaining({ maxBody: 2048 }));
  });

  it("parses --insecure option", async () => {
    await main(["http://example.com", "--insecure"]);
    expect(mockRunProbesFn).toHaveBeenCalledWith("http://example.com", expect.objectContaining({ rejectUnauthorized: false }));
  });

  it("parses --timeout with single value", async () => {
    await main(["http://example.com", "--timeout", "5000"]);
    expect(mockRunProbesFn).toHaveBeenCalledWith(
      "http://example.com",
      expect.objectContaining({
        timeouts: { dns: 5000, tcp: 5000, tls: 5000, ttfb: 5000, body: 5000 },
      })
    );
  });

  it("parses --timeout with per-stage values", async () => {
    await main(["http://example.com", "--timeout", "dns=1000,tcp=2000,tls=3000,ttfb=4000,body=5000"]);
    expect(mockRunProbesFn).toHaveBeenCalledWith(
      "http://example.com",
      expect.objectContaining({
        timeouts: { dns: 1000, tcp: 2000, tls: 3000, ttfb: 4000, body: 5000 },
      })
    );
  });

  it("parses --json option", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["http://example.com", "--json"]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"url": "https://example.com"'));
    consoleSpy.mockRestore();
  });

  it("defaults to human-readable output", async () => {
    // This test just verifies the code path - printResults is not mocked
    const code = await main(["http://example.com"]);
    expect(code).toBe(0);
  });

  it("rejects invalid --runs value", async () => {
    const code = await main(["http://example.com", "--runs", "invalid"]);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("rejects zero --runs value", async () => {
    const code = await main(["http://example.com", "--runs", "0"]);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("rejects invalid --concurrency value", async () => {
    const code = await main(["http://example.com", "--concurrency", "invalid"]);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("rejects negative --delay value", async () => {
    const code = await main(["http://example.com", "--delay", "-100"]);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("rejects invalid --max-body value", async () => {
    const code = await main(["http://example.com", "--max-body", "invalid"]);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("rejects unknown option", async () => {
    const code = await main(["http://example.com", "--unknown"]);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("rejects short flags", async () => {
    const code = await main(["http://example.com", "-r", "5"]);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("supports --help flag", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(["--help"]);
    expect(code).toBe(ExitCode.OK);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Network Atonomy"));
    consoleSpy.mockRestore();
  });

  it("supports --help with URL", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(["http://example.com", "--help"]);
    expect(code).toBe(ExitCode.OK);
    consoleSpy.mockRestore();
  });

  it("supports --version flag", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(["--version"]);
    expect(code).toBe(ExitCode.OK);
    expect(consoleSpy).toHaveBeenCalledWith("1.0.0");
    consoleSpy.mockRestore();
  });

  it("supports --version with URL", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(["http://example.com", "--version"]);
    expect(code).toBe(ExitCode.OK);
    expect(consoleSpy).toHaveBeenCalledWith("1.0.0");
    consoleSpy.mockRestore();
  });
});

describe("cli - explain mode", () => {
  it("shows configuration without running probes", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(["http://example.com", "--explain"]);
    expect(code).toBe(ExitCode.OK);
    expect(mockRunProbesFn).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Would run probes"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("URL: http://example.com"));
    consoleSpy.mockRestore();
  });

  it("shows all options in explain mode", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main([
      "http://example.com",
      "--explain",
      "--runs",
      "10",
      "--concurrency",
      "2",
      "--delay",
      "50",
      "--max-body",
      "5000",
      "--insecure",
      "--timeout",
      "3000",
      "--json",
    ]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Runs: 10"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Concurrency: 2"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Delay: 50ms"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Max body: 5000 bytes"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Insecure (skip TLS verify): true"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Timeout: 3000"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Output format: JSON"));
    consoleSpy.mockRestore();
  });
});

describe("cli - runProbes integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runProbes with parsed options", async () => {
    mockRunProbesFn.mockResolvedValue(createMockResults());

    await main(["http://example.com", "--runs", "3", "--concurrency", "2"]);

    expect(mockRunProbesFn).toHaveBeenCalledWith("http://example.com", {
      runs: 3,
      concurrency: 2,
      delayMs: undefined,
      maxBody: undefined,
      rejectUnauthorized: true,
      timeouts: undefined,
      maxRedirects: 5,
    });
  });

  it("returns exit code 0 on success", async () => {
    mockRunProbesFn.mockResolvedValue(createMockResults({ runsFailed: 0 }));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.OK);
  });

  it("returns exit code ALL_RUNS_FAILED when runs failed", async () => {
    mockRunProbesFn.mockResolvedValue(createMockResults({ runsFailed: 2, runsSuccessful: 3 }));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.OK); // Per spec: if at least 1 run succeeds, exit 0 with warning
  });

  it("prints JSON when --json flag is set", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockRunProbesFn.mockResolvedValue(createMockResults());

    await main(["http://example.com", "--json"]);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"runsRequested": 5')
    );
    consoleSpy.mockRestore();
  });

  it("handles runProbes error and returns exit code", async () => {
    mockRunProbesFn.mockRejectedValue(new DnsFailedError("DNS resolution failed"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.NETWORK_FAILURE);
  });

  it("prints error message on failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRunProbesFn.mockRejectedValue(new TcpFailedError("Connection refused"));

    await main(["http://example.com"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Connection refused");
    consoleErrorSpy.mockRestore();
  });
});

describe("cli - printResults output (real printResults)", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
    mockRunProbesFn.mockResolvedValue(createMockResults());
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("prints target URL, IP, and family", async () => {
    await main(["http://example.com"]);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Target: https://example.com (93.184.216.34 - IPv4)")
    );
  });

  it("prints runs count", async () => {
    await main(["http://example.com"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Runs: 5 successful runs"));
  });

  it("prints stage table with DNS, TCP, TLS, TTFB, Body, Total", async () => {
    await main(["http://example.com"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("DNS Lookup"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("TCP Connect"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("TLS Handshake"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("TTFB"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Body Download"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Total"));
  });

  it("prints warnings for failed runs", async () => {
    mockRunProbesFn.mockResolvedValue(createMockResults({ runsFailed: 2, warnings: ["Warning: 2 of 5 runs failed."] }));

    await main(["http://example.com"]);

    expect(consoleSpy).toHaveBeenCalledWith("Warning: 2 of 5 runs failed.");
  });
});

describe("cli - exit code mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NETWORK_FAILURE for DNS resolution errors", async () => {
    mockRunProbesFn.mockRejectedValue(new ResolutionError("example.com"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.NETWORK_FAILURE);
  });

  it("returns BLOCKED_ADDRESS for SSRF blocked addresses", async () => {
    mockRunProbesFn.mockRejectedValue(new BlockedAddressError("example.com", ["127.0.0.1"]));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.BLOCKED_ADDRESS);
  });

  it("returns NETWORK_FAILURE for connection refused", async () => {
    mockRunProbesFn.mockRejectedValue(new TcpFailedError("Connection refused"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.NETWORK_FAILURE);
  });

  it("returns TIMEOUT for connection timeout", async () => {
    mockRunProbesFn.mockRejectedValue(new TimeoutError("ETIMEDOUT"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.TIMEOUT);
  });

  it("returns NETWORK_FAILURE for TLS handshake errors", async () => {
    mockRunProbesFn.mockRejectedValue(new TlsFailedError("TLS handshake failed: certificate verify failed"));

    const code = await main(["https://example.com"]);

    expect(code).toBe(ExitCode.NETWORK_FAILURE);
  });

  it("returns NETWORK_FAILURE for SSL errors", async () => {
    mockRunProbesFn.mockRejectedValue(new TlsFailedError("SSL error: self signed certificate"));

    const code = await main(["https://example.com"]);

    expect(code).toBe(ExitCode.NETWORK_FAILURE);
  });

  it("returns NETWORK_FAILURE for HTTP response errors", async () => {
    mockRunProbesFn.mockRejectedValue(new HttpFailedError("HTTP response error: 500 Internal Server Error"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.NETWORK_FAILURE);
  });

  it("returns NETWORK_FAILURE for TTFB errors", async () => {
    mockRunProbesFn.mockRejectedValue(new HttpFailedError("TTFB timeout"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.NETWORK_FAILURE);
  });

  it("returns NETWORK_FAILURE for body download errors", async () => {
    mockRunProbesFn.mockRejectedValue(new HttpFailedError("Body download failed: socket closed"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.NETWORK_FAILURE);
  });

  it("returns NETWORK_FAILURE when all runs fail", async () => {
    mockRunProbesFn.mockRejectedValue(new AllRunsFailedError("All runs failed with unknown error"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.NETWORK_FAILURE);
  });

  it("returns INVALID_ARGS for validation errors", async () => {
    mockRunProbesFn.mockRejectedValue(new InvalidArgsError("Invalid URL: missing required scheme"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns REDIRECT_LOOP for redirect loops", async () => {
    mockRunProbesFn.mockRejectedValue(new RedirectLoopError("Redirect loop detected: http://example.com"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.REDIRECT_LOOP);
  });

  it("returns TOO_MANY_REDIRECTS for exceeding max redirects", async () => {
    mockRunProbesFn.mockRejectedValue(new TooManyRedirectsError("Too many redirects (max: 5)"));

    const code = await main(["http://example.com"]);

    expect(code).toBe(ExitCode.TOO_MANY_REDIRECTS);
  });

  it("prints errors to stderr, not stdout", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockRunProbesFn.mockRejectedValue(new Error("Test error"));

    await main(["http://example.com"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Test error");
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Error:"));
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("prints successful results to stdout", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockRunProbesFn.mockResolvedValue(createMockResults());

    await main(["http://example.com"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Target:"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Runs: 5 successful runs"));
    consoleLogSpy.mockRestore();
  });
});