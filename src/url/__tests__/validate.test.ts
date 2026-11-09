import { describe, expect, it } from "vitest";
import {
  ALLOWED_SCHEMES,
  ERROR_MESSAGES,
  MAX_URL_LENGTH,
  isAllowedScheme,
  isWithinLengthLimit,
  validateUrl,
} from "../validate";

describe("isAllowedScheme", () => {
  it("accepts http and https", () => {
    expect(isAllowedScheme("http")).toBe(true);
    expect(isAllowedScheme("https")).toBe(true);
  });

  it("rejects every other scheme", () => {
    for (const scheme of ["ftp", "ftps", "file", "ws", "wss", "javascript", "data", "HTTP", "Https"]) {
      expect(isAllowedScheme(scheme)).toBe(false);
    }
  });

  it("matches the exported allow-list", () => {
    expect(ALLOWED_SCHEMES).toEqual(["http", "https"]);
    for (const scheme of ALLOWED_SCHEMES) {
      expect(isAllowedScheme(scheme)).toBe(true);
    }
  });
});

describe("isWithinLengthLimit", () => {
  it("accepts a URL of exactly 2048 characters", () => {
    expect(isWithinLengthLimit("a".repeat(MAX_URL_LENGTH))).toBe(true);
  });

  it("accepts URLs shorter than the limit", () => {
    expect(isWithinLengthLimit("")).toBe(true);
    expect(isWithinLengthLimit("https://example.com")).toBe(true);
  });

  it("rejects a URL of 2049 characters", () => {
    expect(isWithinLengthLimit("a".repeat(MAX_URL_LENGTH + 1))).toBe(false);
  });
});

describe("validateUrl", () => {
  describe("valid URLs", () => {
    it("accepts a plain http URL with the default port 80", () => {
      expect(validateUrl("http://example.com")).toEqual({
        ok: true,
        input: "http://example.com",
        scheme: "http",
        hostname: "example.com",
        port: 80,
      });
    });

    it("accepts a plain https URL with the default port 443", () => {
      const result = validateUrl("https://example.com");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.scheme).toBe("https");
        expect(result.port).toBe(443);
        expect(result.hostname).toBe("example.com");
      }
    });

    it("accepts an explicit non-standard port", () => {
      const result = validateUrl("https://example.com:8443/path?q=1#frag");
      expect(result).toMatchObject({
        ok: true,
        scheme: "https",
        hostname: "example.com",
        port: 8443,
      });
    });

    it("accepts subdomains and dotted hosts", () => {
      expect(validateUrl("https://api.sub.example.co.uk/x")).toMatchObject({
        ok: true,
        hostname: "api.sub.example.co.uk",
      });
    });

    it("accepts an explicit default port (http on 80)", () => {
      const result = validateUrl("http://example.com:80/");
      expect(result).toMatchObject({ ok: true, port: 80 });
    });

    it("accepts a URL of exactly 2048 characters", () => {
      const url = "https://example.com/" + "a".repeat(MAX_URL_LENGTH - "https://example.com/".length);
      expect(url.length).toBe(MAX_URL_LENGTH);
      expect(validateUrl(url).ok).toBe(true);
    });
  });

  describe("scheme check", () => {
    it.each(["ftp://example.com", "file:///etc/passwd", "ws://example.com:8080", "wss://example.com"])(
      "rejects unsupported scheme: %s",
      (url) => {
        const result = validateUrl(url);
        expect(result).toEqual({
          ok: false,
          code: "invalid-scheme",
          message: ERROR_MESSAGES.invalidScheme,
        });
      },
    );

    it("rejects javascript: and data: URLs that parse without a host", () => {
      for (const url of ["javascript:alert(1)", "data:text/plain,hi"]) {
        expect(validateUrl(url)).toMatchObject({ ok: false, code: "invalid-scheme" });
      }
    });

    it("rejects the scheme string alone (no ://) as unparseable", () => {
      expect(validateUrl("https")).toMatchObject({ ok: false, code: "invalid-url" });
    });

    it("accepts schemes in any letter case (parser normalizes to lowercase)", () => {
      const upper = validateUrl("HTTPS://EXAMPLE.com");
      expect(upper).toMatchObject({ ok: true, scheme: "https", hostname: "example.com" });
      const mixed = validateUrl("Http://example.com");
      expect(mixed).toMatchObject({ ok: true, scheme: "http", hostname: "example.com" });
    });
  });

  describe("length limit", () => {
    it("rejects a URL of 2049 characters with the spec message", () => {
      const url = "https://example.com/" + "a".repeat(MAX_URL_LENGTH + 1 - "https://example.com/".length);
      expect(url.length).toBe(MAX_URL_LENGTH + 1);
      expect(validateUrl(url)).toEqual({
        ok: false,
        code: "url-too-long",
        message: ERROR_MESSAGES.urlTooLong,
      });
    });

    it("reports url-too-long, not invalid-url, for an over-length garbage string", () => {
      const garbage = "not a url".repeat(400); // far over the limit, unparseable
      expect(garbage.length).toBeGreaterThan(MAX_URL_LENGTH);
      expect(validateUrl(garbage)).toMatchObject({ ok: false, code: "url-too-long" });
    });

    it("checks length before parseability (length is the first check)", () => {
      const url = "http://" + "a".repeat(MAX_URL_LENGTH); // parseable but over limit
      expect(validateUrl(url)).toMatchObject({ ok: false, code: "url-too-long" });
    });
  });

  describe("parseability", () => {
    it("rejects an empty string", () => {
      expect(validateUrl("")).toMatchObject({ ok: false, code: "invalid-url" });
    });

    it("rejects a bare hostname without a scheme", () => {
      expect(validateUrl("example.com")).toMatchObject({ ok: false, code: "invalid-url" });
    });

    it("rejects a scheme-relative URL with no host", () => {
      expect(validateUrl("http://")).toMatchObject({ ok: false, code: "invalid-url" });
    });

    it("rejects a random non-URL string", () => {
      expect(validateUrl("not a url")).toMatchObject({ ok: false, code: "invalid-url" });
    });

    it("rejects an out-of-range port", () => {
      expect(validateUrl("http://example.com:99999/")).toMatchObject({ ok: false, code: "invalid-url" });
    });

    it("includes a message for every invalid result", () => {
      const invalids = [
        validateUrl(""),
        validateUrl("ftp://example.com"),
        validateUrl("a".repeat(MAX_URL_LENGTH + 1)),
      ];
      for (const result of invalids) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.message).toBeTypeOf("string");
          expect(result.message.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("purity", () => {
    it("returns a fresh result object on every call", () => {
      const a = validateUrl("https://example.com");
      const b = validateUrl("https://example.com");
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });

    it("never mutates its input", () => {
      const input = "https://Example.com/Path?q=1";
      validateUrl(input);
      expect(input).toBe("https://Example.com/Path?q=1");
    });
  });
});
