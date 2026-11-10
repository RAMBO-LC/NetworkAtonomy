import { describe, it, expect, vi } from "vitest";
import { resolveHostname, ResolutionError, BlockedAddressError, type DnsResolver } from "../resolve";

describe("resolveHostname", () => {
  const createFakeResolver = (ipv4: string[] = [], ipv6: string[] = []): DnsResolver => {
    return vi.fn().mockResolvedValue({ ipv4, ipv6 });
  };

  describe("successful resolution", () => {
    it("resolves IPv4 and returns first IPv4 address", async () => {
      const resolver = createFakeResolver(["8.8.8.8", "8.8.4.4"], []);
      const result = await resolveHostname("example.com", resolver);

      expect(result).toEqual({ address: "8.8.8.8", family: "ipv4" });
      expect(resolver).toHaveBeenCalledWith("example.com");
    });

    it("resolves IPv6 when no IPv4 available", async () => {
      const resolver = createFakeResolver([], ["2001:4860:4860::8888"]);
      const result = await resolveHostname("ipv6.example.com", resolver);

      expect(result).toEqual({ address: "2001:4860:4860::8888", family: "ipv6" });
    });

    it("prefers IPv4 over IPv6 when both present", async () => {
      const resolver = createFakeResolver(["1.1.1.1"], ["2606:4700:4700::1111"]);
      const result = await resolveHostname("dual.example.com", resolver);

      expect(result).toEqual({ address: "1.1.1.1", family: "ipv4" });
    });

    it("normalizes IPv6 address", async () => {
      const resolver = createFakeResolver([], ["2001:0db8:0000:0000:0000:0000:0000:0001"]);
      const result = await resolveHostname("example.com", resolver);

      // Should be compressed form
      expect(result.address).toBe("2001:db8::1");
      expect(result.family).toBe("ipv6");
    });
  });

  describe("SSRF guard - blocked IPv4 addresses", () => {
    const blockedIpv4Cases = [
      { name: "private-10", ip: "10.0.0.1" },
      { name: "private-172", ip: "172.16.0.1" },
      { name: "private-192", ip: "192.168.0.1" },
      { name: "loopback", ip: "127.0.0.1" },
      { name: "link-local", ip: "169.254.0.1" },
      { name: "unspecified", ip: "0.0.0.1" },
      { name: "multicast", ip: "224.0.0.1" },
      { name: "reserved", ip: "240.0.0.1" },
    ];

    blockedIpv4Cases.forEach(({ name, ip }) => {
      it(`blocks ${name} range: ${ip}`, async () => {
        const resolver = createFakeResolver([ip], []);
        await expect(resolveHostname("blocked.example.com", resolver)).rejects.toThrow(BlockedAddressError);
      });
    });

    it("blocks when ANY IPv4 is blocked (even if others allowed)", async () => {
      // Mix of allowed and blocked IPs - should still block
      const resolver = createFakeResolver(["8.8.8.8", "10.0.0.1"], []);
      await expect(resolveHostname("mixed.example.com", resolver)).rejects.toThrow(BlockedAddressError);
    });

    it("includes all blocked addresses in error", async () => {
      const resolver = createFakeResolver(["10.0.0.1", "127.0.0.1"], []);
      try {
        await resolveHostname("multi-blocked.example.com", resolver);
      } catch (e) {
        expect(e).toBeInstanceOf(BlockedAddressError);
        const error = e as BlockedAddressError;
        expect(error.blockedAddresses).toContain("10.0.0.1");
        expect(error.blockedAddresses).toContain("127.0.0.1");
      }
    });
  });

  describe("SSRF guard - blocked IPv6 addresses", () => {
    const blockedIpv6Cases = [
      { name: "loopback", ip: "::1" },
      { name: "link-local", ip: "fe80::1" },
      { name: "unique-local", ip: "fc00::1" },
      { name: "unspecified", ip: "::" },
      { name: "multicast", ip: "ff00::1" },
    ];

    blockedIpv6Cases.forEach(({ name, ip }) => {
      it(`blocks ${name} range: ${ip}`, async () => {
        const resolver = createFakeResolver([], [ip]);
        await expect(resolveHostname("blocked.example.com", resolver)).rejects.toThrow(BlockedAddressError);
      });
    });

    it("blocks when ANY IPv6 is blocked (even if others allowed)", async () => {
      const resolver = createFakeResolver([], ["2001:db8::1", "::1"]);
      await expect(resolveHostname("mixed.example.com", resolver)).rejects.toThrow(BlockedAddressError);
    });

    it("blocks when IPv4 allowed but IPv6 blocked", async () => {
      const resolver = createFakeResolver(["8.8.8.8"], ["::1"]);
      await expect(resolveHostname("mixed.example.com", resolver)).rejects.toThrow(BlockedAddressError);
    });
  });

  describe("SSRF guard - blocked IPv4-mapped IPv6", () => {
    it("blocks IPv4-mapped loopback (::ffff:127.0.0.1)", async () => {
      const resolver = createFakeResolver([], ["::ffff:127.0.0.1"]);
      await expect(resolveHostname("mapped.example.com", resolver)).rejects.toThrow(BlockedAddressError);
    });

    it("blocks IPv4-mapped private (::ffff:10.0.0.1)", async () => {
      const resolver = createFakeResolver([], ["::ffff:10.0.0.1"]);
      await expect(resolveHostname("mapped.example.com", resolver)).rejects.toThrow(BlockedAddressError);
    });
  });

  describe("resolution errors", () => {
    it("throws ResolutionError when no addresses returned", async () => {
      const resolver = createFakeResolver([], []);
      await expect(resolveHostname("empty.example.com", resolver)).rejects.toThrow(ResolutionError);
    });

    it("throws ResolutionError when resolver returns empty arrays", async () => {
      const resolver = createFakeResolver([], []);
      await expect(resolveHostname("nxdomain.example.com", resolver)).rejects.toThrow(ResolutionError);
    });
  });

  describe("resolver injection", () => {
    it("uses injected resolver (not default)", async () => {
      const customResolver = vi.fn().mockResolvedValue({ ipv4: ["1.2.3.4"], ipv6: [] });
      await resolveHostname("test.example.com", customResolver);
      expect(customResolver).toHaveBeenCalledWith("test.example.com");
    });

    it("allows fake resolver to simulate network conditions", async () => {
      // Simulate a resolver that only returns blocked IPs
      const maliciousResolver = createFakeResolver(["127.0.0.1"], []);
      await expect(resolveHostname("victim.com", maliciousResolver)).rejects.toThrow(BlockedAddressError);
    });
  });

  describe("error types", () => {
    it("ResolutionError has correct name and message", async () => {
      const resolver = createFakeResolver([], []);
      try {
        await resolveHostname("nonexistent.example.com", resolver);
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ResolutionError);
        const err = e as ResolutionError;
        expect(err.name).toBe("ResolutionError");
        expect(err.message).toContain("nonexistent.example.com");
      }
    });

    it("BlockedAddressError has correct name, message, and blockedAddresses", async () => {
      const resolver = createFakeResolver(["10.0.0.1"], []);
      try {
        await resolveHostname("blocked.example.com", resolver);
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(BlockedAddressError);
        const err = e as BlockedAddressError;
        expect(err.name).toBe("BlockedAddressError");
        expect(err.message).toContain("blocked.example.com");
        expect(err.message).toContain("10.0.0.1");
        expect(err.blockedAddresses).toEqual(["10.0.0.1"]);
      }
    });
  });
});