/**
 * Pure URL validation for the reqanatomy CLI.
 *
 * Enforces the input limits from `docs/spec.md` (Section 1, Section 2) and
 * `docs/parameters.md` ("Input Limits"):
 *
 * - The URL must be at most `MAX_URL_LENGTH` characters long.
 * - The scheme must be `http` or `https` (no `ftp://`, `file://`, etc.).
 *
 * Every function in this module is pure: deterministic for a given input,
 * no I/O, no global state read or written. The CLI layer (Task 13) maps the
 * `InvalidUrl.code` values to exit code 1 and prints `Error: <message>`.
 */

/** Maximum total URL length in characters (docs/parameters.md). */
export const MAX_URL_LENGTH = 2048;

/** Schemes reqanatomy will probe (docs/parameters.md "Allowed schemes"). */
export const ALLOWED_SCHEMES = ["http", "https"] as const;

export type AllowedScheme = (typeof ALLOWED_SCHEMES)[number];

/** Default port per scheme, applied when the URL omits an explicit port. */
const DEFAULT_PORTS: Record<AllowedScheme, number> = {
  http: 80,
  https: 443,
};

export interface ValidUrl {
  ok: true;
  /** The input string, unmodified. */
  input: string;
  /** The validated scheme, without the trailing colon. */
  scheme: AllowedScheme;
  /** The host as written in the URL (the parser lowercases it). */
  hostname: string;
  /** The explicit port, or the scheme default (80 for http, 443 for https). */
  port: number;
}

/** Machine-readable reason codes for an invalid URL. */
export type InvalidUrlCode = "url-too-long" | "invalid-scheme" | "invalid-url";

export interface InvalidUrl {
  ok: false;
  code: InvalidUrlCode;
  /**
   * Human-facing message, matching the spec's `Error: <message>` format.
   * Callers print it to stderr prefixed with `Error: `.
   */
  message: string;
}

export type UrlValidationResult = ValidUrl | InvalidUrl;

/** Spec-mandated error messages (docs/spec.md Section 1). */
export const ERROR_MESSAGES = {
  urlTooLong: `URL exceeds maximum allowed length of ${MAX_URL_LENGTH} characters.`,
  invalidScheme: "Invalid URL scheme. Only http:// and https:// are supported.",
  invalidUrl: "Invalid URL. Provide a full http:// or https:// URL.",
} as const;

/**
 * True when `scheme` is a scheme reqanatomy probes.
 * Type predicate so the result narrows to `AllowedScheme` on `true`.
 */
export function isAllowedScheme(scheme: string): scheme is AllowedScheme {
  return scheme === "http" || scheme === "https";
}

/** True when `input` is at or below the maximum URL length (inclusive). */
export function isWithinLengthLimit(input: string): boolean {
  return input.length <= MAX_URL_LENGTH;
}

/**
 * Validate a CLI-supplied URL string.
 *
 * Check order:
 * 1. Length — rejected before parsing, so an over-length garbage string is
 *    reported as `url-too-long`, not `invalid-url`.
 * 2. Parseability — `new URL()` throws for unparseable input.
 * 3. Scheme — only `http`/`https` are probed. The WHATWG parser lowercases
 *    schemes, so the check is case-insensitive (`HTTPS://...` is accepted).
 */
export function validateUrl(input: string): UrlValidationResult {
  if (!isWithinLengthLimit(input)) {
    return { ok: false, code: "url-too-long", message: ERROR_MESSAGES.urlTooLong };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, code: "invalid-url", message: ERROR_MESSAGES.invalidUrl };
  }

  const scheme = parsed.protocol.slice(0, -1);
  if (!isAllowedScheme(scheme)) {
    return { ok: false, code: "invalid-scheme", message: ERROR_MESSAGES.invalidScheme };
  }

  const port = parsed.port === "" ? DEFAULT_PORTS[scheme] : Number(parsed.port);

  return { ok: true, input, scheme, hostname: parsed.hostname, port };
}
