/**
 * Standardized exit codes and error types for Network Atonomy CLI.
 */

export enum ExitCode {
  /** Successful execution. */
  OK = 0,
  /** Invalid command-line arguments provided. */
  INVALID_ARGS = 1,
  /** Blocked address (SSRF guard). */
  BLOCKED_ADDRESS = 2,
  /** Network Failure: DNS resolution failed, connection refused, host unreachable, or TLS verification failed. */
  NETWORK_FAILURE = 3,
  /** Timeout: any stage timed out exceeding configured limits. */
  TIMEOUT = 4,
  /** Redirect loop detected. */
  REDIRECT_LOOP = 7,
  /** Too many redirects. */
  TOO_MANY_REDIRECTS = 8,
  /** Internal/unexpected error. */
  INTERNAL_ERROR = 255,
}

/**
 * Base class for all Network Atonomy errors.
 *
 * Every subclass carries a single, immutable `exitCode` property. The CLI's
 * `mapErrorToExitCode` reads that property and never inspects the error
 * message, so a reworded message can never change the exit code.
 */
export abstract class NetworkAtonomyError extends Error {
  public readonly exitCode: ExitCode;
  public readonly stage: string;

  constructor(message: string, exitCode: ExitCode, stage: string) {
    super(message);
    this.name = this.constructor.name;
    this.exitCode = exitCode;
    this.stage = stage;
    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** Error thrown when command-line arguments are invalid. */
export class InvalidArgsError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.INVALID_ARGS, "args");
    this.name = "InvalidArgsError";
  }
}

/** Error thrown when DNS resolution fails. */
export class DnsFailedError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.NETWORK_FAILURE, "dns");
    this.name = "DnsFailedError";
  }
}

/** Error thrown when TCP connection fails. */
export class TcpFailedError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.NETWORK_FAILURE, "tcp");
    this.name = "TcpFailedError";
  }
}

/** Error thrown when TLS handshake fails. */
export class TlsFailedError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.NETWORK_FAILURE, "tls");
    this.name = "TlsFailedError";
  }
}

/** Error thrown when HTTP request fails (TTFB or body download). */
export class HttpFailedError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.NETWORK_FAILURE, "http");
    this.name = "HttpFailedError";
  }
}

/** Error thrown when a timeout occurs. */
export class TimeoutError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.TIMEOUT, "timeout");
    this.name = "TimeoutError";
  }
}

/** Error thrown when all probe runs fail. */
export class AllRunsFailedError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.NETWORK_FAILURE, "all");
    this.name = "AllRunsFailedError";
  }
}

/** Error thrown when a redirect loop is detected. */
export class RedirectLoopError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.REDIRECT_LOOP, "redirect");
    this.name = "RedirectLoopError";
  }
}

/** Error thrown when too many redirects are encountered. */
export class TooManyRedirectsError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.TOO_MANY_REDIRECTS, "redirect");
    this.name = "TooManyRedirectsError";
  }
}

/** Error thrown for unexpected internal errors. */
export class InternalError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.INTERNAL_ERROR, "internal");
    this.name = "InternalError";
  }
}

/**
 * Maps an error to its corresponding ExitCode.
 * Returns INTERNAL_ERROR for unknown error types.
 */
export function getExitCode(error: unknown): ExitCode {
  if (error instanceof NetworkAtonomyError) {
    return error.exitCode;
  }
  return ExitCode.INTERNAL_ERROR;
}

/**
 * Checks if an error is a NetworkAtonomyError (typed error).
 */
export function isNetworkAtonomyError(error: unknown): error is NetworkAtonomyError {
  return error instanceof NetworkAtonomyError;
}