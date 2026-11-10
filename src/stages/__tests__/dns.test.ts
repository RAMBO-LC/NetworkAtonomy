import { describe, it, expect, vi } from "vitest";
import { measureDns, type DnsTimingResult } from "../dns";
import { type DnsResolver } from "../../net/resolve";

describe("measureDns", () => {
  const createFakeResolver = (
    ipv4: string[] = [],
    ipv6: string[] = [],
    delayMs = 0,
  ): DnsResolver => {
    return vi.fn().mockImplementation(async (hostname: string) => {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return { ipv4, ipv6 };
    });
  };

  it("returns a positive duration when resolver resolves", async () => {
    const resolver = createFakeResolver(["8.8.8.8"], [], 20);
    const result = await measureDns("example.com", resolver);

    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeLessThan(200);
  });

  it("returns the resolved addresses from the resolver", async () => {
    const resolver = createFakeResolver(["8.8.8.8", "8.8.4.4"], ["2001:4860:4860::8888"]);
    const result = await measureDns("example.com", resolver);

    expect(result.addresses.ipv4).toEqual(["8.8.8.8", "8.8.4.4"]);
    expect(result.addresses.ipv6).toEqual(["2001:4860:4860::8888"]);
  });

  it("calls the resolver with the hostname", async () => {
    const resolver = createFakeResolver(["1.2.3.4"], []);
    await measureDns("target.example.com", resolver);

    expect(resolver).toHaveBeenCalledWith("target.example.com");
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("captures the full resolver delay in the timing", async () => {
    const resolver = createFakeResolver(["8.8.8.8"], [], 50);
    const result = await measureDns("example.com", resolver);

    // The measured duration should include the artificial delay.
    expect(result.durationMs).toBeGreaterThanOrEqual(45);
    expect(result.durationMs).toBeLessThan(200);
  });

  it("returns a DnsTimingResult with the expected shape", async () => {
    const resolver = createFakeResolver(["8.8.8.8"], []);
    const result: DnsTimingResult = await measureDns("example.com", resolver);

    expect(result).toEqual({
      durationMs: expect.any(Number),
      addresses: { ipv4: ["8.8.8.8"], ipv6: [] },
    });
  });

  it("returns empty arrays when resolver returns none", async () => {
    const resolver = createFakeResolver([], []);
    const result = await measureDns("empty.example.com", resolver);

    expect(result.addresses.ipv4).toEqual([]);
    expect(result.addresses.ipv6).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("wires the default resolver as the second optional parameter", () => {
    // measureDns(hostname, resolver?) — one required param, one optional.
    expect(measureDns.length).toBe(1);
  });
});