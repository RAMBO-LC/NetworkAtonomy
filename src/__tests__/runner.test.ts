/**
 * Tests for runs orchestration and median calculation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runProbes,
  calculateMedian,
  calculateStageStats,
  formatMs,
  printResults,
  type RunTimingResult,
  type AggregatedResults,
  type ProbeOptions,
} from "../runner";
import { type ValidUrl } from "../url/validate";

// Mock performance.now for timing tests
let performanceNowValue = 0;
vi.mock("node:perf_hooks", () => ({
  performance: {
    now: vi.fn(() => performanceNowValue),
  },
}));

function advancePerformanceNow(ms: number) {
  performanceNowValue += ms;
}

// Mock the stage modules
vi.mock("../stages/dns", () => ({
  measureDns: vi.fn(),
}));

vi.mock("../stages/tcp", () => ({
  measureTcp: vi.fn(),
}));

vi.mock("../stages/tls", () => ({
  measureTls: vi.fn(),
}));

vi.mock("../stages/http", () => ({
  measureHttp: vi.fn(),
  DEFAULT_MAX_BODY: 10 * 1024 * 1024,
}));

vi.mock("../net/resolve", () => ({
  resolveHostname: vi.fn(),
  defaultDnsResolver: vi.fn(),
  ResolutionError: class extends Error { constructor(h: string) { super(`DNS resolution failed for ${h}`); this.name = "ResolutionError"; } },
  BlockedAddressError: class extends Error { constructor(h: string, addrs: string[]) { super(`SSRF guard blocked ${h}: ${addrs.join(", ")}`); this.name = "BlockedAddressError"; this.blockedAddresses = addrs; } },
}));

// Hoisted mock for validateUrl
const mockValidateUrlFn = vi.hoisted(() => vi.fn());

vi.mock("../url/validate", () => ({
  validateUrl: mockValidateUrlFn,
  MAX_URL_LENGTH: 2048,
  ALLOWED_SCHEMES: ["http", "https"] as const,
  ERROR_MESSAGES: {
    urlTooLong: "URL exceeds maximum allowed length of 2048 characters.",
    invalidScheme: "Invalid URL scheme. Only http:// and https:// are supported.",
    invalidUrl: "Invalid URL. Provide a full http:// or https:// URL.",
  },
  isAllowedScheme: vi.fn(),
  isWithinLengthLimit: vi.fn(),
}));

// Import mocked functions
import { measureDns } from "../stages/dns";
import { measureTcp } from "../stages/tcp";
import { measureTls } from "../stages/tls";
import { measureHttp } from "../stages/http";
import { resolveHostname } from "../net/resolve";

const mockMeasureDns = vi.mocked(measureDns);
const mockMeasureTcp = vi.mocked(measureTcp);
const mockMeasureTls = vi.mocked(measureTls);
const mockMeasureHttp = vi.mocked(measureHttp);
const mockResolveHostname = vi.mocked(resolveHostname);
const mockValidateUrl = mockValidateUrlFn;

const createValidUrl = (overrides: Partial<ValidUrl> = {}): ValidUrl => ({
  ok: true,
  input: "http://example.com",
  scheme: "http",
  hostname: "example.com",
  port: 80,
  ...overrides,
});

const createRunTiming = (overrides: Partial<RunTimingResult> = {}): RunTimingResult => ({
  dnsMs: 10,
  tcpMs: 20,
  tlsMs: 0,
  ttfbMs: 50,
  bodyMs: 5,
  totalMs: 85,
  statusCode: 200,
  bytesReceived: 1024,
  ip: "93.184.216.34",
  family: "ipv4",
  ...overrides,
});

describe("runner - median calculation", () => {
  it("calculates median for odd number of values", () => {
    expect(calculateMedian([10, 20, 30])).toBe(20);
    expect(calculateMedian([5, 15, 25, 35, 45])).toBe(25);
  });

  it("calculates median for even number of values", () => {
    expect(calculateMedian([10, 20])).toBe(15);
    expect(calculateMedian([10, 20, 30, 40])).toBe(25);
    expect(calculateMedian([1, 2, 3, 4, 5, 6])).toBe(3.5);
  });

  it("handles single value", () => {
    expect(calculateMedian([42])).toBe(42);
  });

  it("handles empty array", () => {
    expect(calculateMedian([])).toBe(0);
  });

  it("handles unsorted input", () => {
    expect(calculateMedian([30, 10, 20])).toBe(20);
    expect(calculateMedian([40, 10, 30, 20])).toBe(25);
  });
});

describe("runner - stage stats calculation", () => {
  it("calculates median, min, max for multiple values", () => {
    const stats = calculateStageStats([10, 20, 30, 40, 50]);
    expect(stats.medianMs).toBe(30);
    expect(stats.minMs).toBe(10);
    expect(stats.maxMs).toBe(50);
  });

  it("calculates stats for even count", () => {
    const stats = calculateStageStats([10, 20, 30, 40]);
    expect(stats.medianMs).toBe(25);
    expect(stats.minMs).toBe(10);
    expect(stats.maxMs).toBe(40);
  });

  it("handles single value", () => {
    const stats = calculateStageStats([42]);
    expect(stats.medianMs).toBe(42);
    expect(stats.minMs).toBe(42);
    expect(stats.maxMs).toBe(42);
  });

  it("handles empty array", () => {
    const stats = calculateStageStats([]);
    expect(stats.medianMs).toBe(0);
    expect(stats.minMs).toBe(0);
    expect(stats.maxMs).toBe(0);
  });
});

describe("runner - formatMs", () => {
  it("formats with two decimal places", () => {
    expect(formatMs(10)).toBe("10.00");
    expect(formatMs(10.5)).toBe("10.50");
    // JavaScript toFixed uses round-half-up but floating point precision affects exact halfway cases
    expect(formatMs(10.555)).toBe("10.55"); // 10.555 is stored as 10.554999..., rounds down
    expect(formatMs(10.565)).toBe("10.56"); // 10.565 rounds to 10.56
    expect(formatMs(0)).toBe("0.00");
  });
});

describe("runner - runProbes orchestration", () => {
  const validUrl = createValidUrl();
  const resolvedHost = { address: "93.184.216.34", family: "ipv4" as const };
  const dnsResult = { durationMs: 10, addresses: { ipv4: ["93.184.216.34"], ipv6: [] } };
  const tcpResult = { durationMs: 20, socket: { on: vi.fn(), once: vi.fn(), write: vi.fn(), destroy: vi.fn(), removeListener: vi.fn() } };
  const tlsResult = { durationMs: 30, socket: tcpResult.socket };
  const httpResult = { ttfbMs: 50, bodyMs: 5, statusCode: 200, bytesReceived: 1024 };

  beforeEach(() => {
    vi.clearAllMocks();
    performanceNowValue = 0;
    mockValidateUrl.mockReturnValue(validUrl);
    mockResolveHostname.mockResolvedValue(resolvedHost);
    mockMeasureDns.mockResolvedValue(dnsResult);
    mockMeasureTcp.mockResolvedValue(tcpResult);
    mockMeasureTls.mockResolvedValue(tlsResult);
    mockMeasureHttp.mockResolvedValue(httpResult);
  });

  it("executes runs sequentially by default", async () => {
    const results = await runProbes("http://example.com", { runs: 3 });

    expect(results.runsRequested).toBe(3);
    expect(results.runsSuccessful).toBe(3);
    expect(results.runsFailed).toBe(0);
    expect(mockMeasureDns).toHaveBeenCalledTimes(3);
    expect(mockMeasureTcp).toHaveBeenCalledTimes(3);
    expect(mockMeasureTls).toHaveBeenCalledTimes(3);
    expect(mockMeasureHttp).toHaveBeenCalledTimes(3);
  });

  it("calculates correct median across runs", async () => {
    // Vary the timing across runs by advancing performance.now
    let dnsCallCount = 0;
    mockMeasureDns.mockImplementation(async () => {
      const durations = [10, 20, 30];
      const duration = durations[dnsCallCount++];
      advancePerformanceNow(duration);
      return { durationMs: duration, addresses: { ipv4: ["1.2.3.4"], ipv6: [] } };
    });

    const results = await runProbes("http://example.com", { runs: 3 });

    // Median of [10, 20, 30] = 20
    expect(results.stages.dns.medianMs).toBe(20);
    expect(results.stages.dns.minMs).toBe(10);
    expect(results.stages.dns.maxMs).toBe(30);
  });

  it("calculates median for even number of runs", async () => {
    let dnsCallCount = 0;
    mockMeasureDns.mockImplementation(async () => {
      const durations = [10, 20, 30, 40];
      const duration = durations[dnsCallCount++];
      advancePerformanceNow(duration);
      return { durationMs: duration, addresses: { ipv4: ["1.2.3.4"], ipv6: [] } };
    });

    const results = await runProbes("http://example.com", { runs: 4 });

    // Median of [10, 20, 30, 40] = 25
    expect(results.stages.dns.medianMs).toBe(25);
    expect(results.stages.dns.minMs).toBe(10);
    expect(results.stages.dns.maxMs).toBe(40);
  });

  it("handles partial run failures", async () => {
    let dnsCallCount = 0;
    mockMeasureDns.mockImplementation(async () => {
      if (dnsCallCount === 1) {
        dnsCallCount++;
        throw new Error("Network error");
      }
      dnsCallCount++;
      return { durationMs: 10, addresses: { ipv4: ["1.2.3.4"], ipv6: [] } };
    });

    const results = await runProbes("http://example.com", { runs: 3 });

    expect(results.runsRequested).toBe(3);
    expect(results.runsSuccessful).toBe(2);
    expect(results.runsFailed).toBe(1);
    expect(results.warnings).toContain("Warning: 1 of 3 runs failed.");
  });

  it("throws when all runs fail", async () => {
    mockMeasureDns.mockRejectedValue(new Error("DNS resolution failed"));

    await expect(runProbes("http://example.com", { runs: 3 })).rejects.toThrow("DNS resolution failed");
  });

  it("includes correct URL, IP, and family in results", async () => {
    const results = await runProbes("http://example.com", { runs: 1 });

    expect(results.url).toBe("http://example.com");
    expect(results.ip).toBe("93.184.216.34");
    expect(results.family).toBe("IPv4");
  });

  it("uses injected DNS resolver when provided", async () => {
    const customResolver = vi.fn().mockResolvedValue({ ipv4: ["1.2.3.4"], ipv6: [] });
    mockResolveHostname.mockResolvedValue({ address: "1.2.3.4", family: "ipv4" });

    await runProbes("http://example.com", { runs: 1, dnsResolver: customResolver });

    expect(mockResolveHostname).toHaveBeenCalledWith("example.com", customResolver);
  });

  it("handles HTTPS with TLS timing", async () => {
    const httpsUrl = createValidUrl({ scheme: "https", port: 443, input: "https://example.com" });
    mockValidateUrl.mockReturnValue(httpsUrl);
    mockMeasureTls.mockResolvedValue({ durationMs: 40, socket: tcpResult.socket });

    const results = await runProbes("https://example.com", { runs: 1 });

    expect(results.stages.tls.medianMs).toBe(40);
    expect(results.family).toBe("IPv4");
  });

  it("respects delay between runs", async () => {
    const delaySpy = vi.spyOn(global, "setTimeout").mockImplementation((cb) => cb() as any);

    await runProbes("http://example.com", { runs: 2, delayMs: 100 });

    expect(delaySpy).toHaveBeenCalledWith(expect.any(Function), 100);
    delaySpy.mockRestore();
  });

  it("handles IPv6 addresses", async () => {
    const ipv6Host = { address: "2606:2800:220:1:248:1893:25c8:1946", family: "ipv6" as const };
    mockResolveHostname.mockResolvedValue(ipv6Host);

    const results = await runProbes("http://example.com", { runs: 1 });

    expect(results.ip).toBe("2606:2800:220:1:248:1893:25c8:1946");
    expect(results.family).toBe("IPv6");
  });
});

describe("runner - concurrent execution", () => {
  const validUrl = createValidUrl();
  const resolvedHost = { address: "93.184.216.34", family: "ipv4" as const };
  const dnsResult = { durationMs: 10, addresses: { ipv4: ["93.184.216.34"], ipv6: [] } };
  const tcpResult = { durationMs: 20, socket: { on: vi.fn(), once: vi.fn(), write: vi.fn(), destroy: vi.fn(), removeListener: vi.fn() } };
  const tlsResult = { durationMs: 0, socket: tcpResult.socket };
  const httpResult = { ttfbMs: 50, bodyMs: 5, statusCode: 200, bytesReceived: 1024 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateUrl.mockReturnValue(validUrl);
    mockResolveHostname.mockResolvedValue(resolvedHost);
    mockMeasureDns.mockResolvedValue(dnsResult);
    mockMeasureTcp.mockResolvedValue(tcpResult);
    mockMeasureTls.mockResolvedValue(tlsResult);
    mockMeasureHttp.mockResolvedValue(httpResult);
  });

  it("executes runs concurrently when concurrency > 1", async () => {
    const results = await runProbes("http://example.com", { runs: 4, concurrency: 2 });

    expect(results.runsRequested).toBe(4);
    expect(results.runsSuccessful).toBe(4);
  });

  it("limits concurrent runs to concurrency setting", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    mockMeasureDns.mockImplementation(async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((r) => setTimeout(r, 10));
      concurrentCount--;
      return { durationMs: 10, addresses: { ipv4: ["1.2.3.4"], ipv6: [] } };
    });

    await runProbes("http://example.com", { runs: 6, concurrency: 2 });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

describe("runner - error handling", () => {
  const validUrl = createValidUrl();
  const resolvedHost = { address: "93.184.216.34", family: "ipv4" as const };
  const dnsResult = { durationMs: 10, addresses: { ipv4: ["93.184.216.34"], ipv6: [] } };
  const tcpResult = { durationMs: 20, socket: { on: vi.fn(), once: vi.fn(), write: vi.fn(), destroy: vi.fn(), removeListener: vi.fn() } };
  const tlsResult = { durationMs: 0, socket: tcpResult.socket };
  const httpResult = { ttfbMs: 50, bodyMs: 5, statusCode: 200, bytesReceived: 1024 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateUrl.mockReturnValue(validUrl);
    mockResolveHostname.mockResolvedValue(resolvedHost);
    mockMeasureDns.mockResolvedValue(dnsResult);
    mockMeasureTcp.mockResolvedValue(tcpResult);
    mockMeasureTls.mockResolvedValue(tlsResult);
    mockMeasureHttp.mockResolvedValue(httpResult);
  });

  it("throws on invalid URL", async () => {
    mockValidateUrl.mockReturnValue({
      ok: false,
      code: "invalid-url",
      message: "Invalid URL. Provide a full http:// or https:// URL.",
    });

    await expect(runProbes("not-a-url")).rejects.toThrow("Error: Invalid URL. Provide a full http:// or https:// URL.");
  });

  it("throws on URL too long", async () => {
    mockValidateUrl.mockReturnValue({
      ok: false,
      code: "url-too-long",
      message: "URL exceeds maximum allowed length of 2048 characters.",
    });

    await expect(runProbes("http://example.com")).rejects.toThrow("Error: URL exceeds maximum allowed length of 2048 characters.");
  });

  it("throws on invalid scheme", async () => {
    mockValidateUrl.mockReturnValue({
      ok: false,
      code: "invalid-scheme",
      message: "Invalid URL scheme. Only http:// and https:// are supported.",
    });

    await expect(runProbes("ftp://example.com")).rejects.toThrow("Error: Invalid URL scheme. Only http:// and https:// are supported.");
  });

  it("propagates DNS resolution errors", async () => {
    mockResolveHostname.mockRejectedValue(new Error("DNS resolution failed: NXDOMAIN"));

    await expect(runProbes("http://example.com")).rejects.toThrow("DNS resolution failed: NXDOMAIN");
  });

  it("propagates blocked address errors", async () => {
    const blockedError = new Error("SSRF guard blocked example.com: 127.0.0.1");
    blockedError.name = "BlockedAddressError";
    mockResolveHostname.mockRejectedValue(blockedError);

    await expect(runProbes("http://example.com")).rejects.toThrow("SSRF guard blocked example.com: 127.0.0.1");
  });
});

describe("runner - printResults", () => {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    consoleSpy.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockClear();
  });

  it("prints formatted results", () => {
    const results: AggregatedResults = {
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
    };

    printResults(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Target: https://example.com (93.184.216.34 - IPv4)"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Runs: 5 successful runs"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("DNS Lookup"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("12.40 ms"));
  });

  it("prints warnings for failed runs", () => {
    const results: AggregatedResults = {
      stages: {
        dns: { medianMs: 12.4, minMs: 10.1, maxMs: 15.2 },
        tcp: { medianMs: 24.15, minMs: 22.0, maxMs: 28.5 },
        tls: { medianMs: 45.3, minMs: 42.1, maxMs: 51.0 },
        ttfb: { medianMs: 110.8, minMs: 105.2, maxMs: 120.4 },
        body: { medianMs: 15.2, minMs: 12.0, maxMs: 19.1 },
      },
      total: { medianMs: 207.85, minMs: 191.4, maxMs: 234.2 },
      runsRequested: 5,
      runsSuccessful: 3,
      runsFailed: 2,
      url: "https://example.com",
      ip: "93.184.216.34",
      family: "IPv4",
      warnings: ["Warning: 2 of 5 runs failed."],
    };

    printResults(results);

    expect(consoleSpy).toHaveBeenCalledWith("Warning: 2 of 5 runs failed.");
  });
});