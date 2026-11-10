/**
 * Standardized exit codes and error types for Network Atonomy CLI.
 */

export enum ExitCode {
  /** Successful execution. */
  OK = 0,
  /** Invalid command-line arguments provided. */
  INVALID_ARGS = 1,
  /** DNS resolution failed. */
  DNS_FAILED = 2,
  /** TCP connection failed. */
  TCP_FAILED = 3,
  /** TLS handshake failed. */
  TLS_FAILED = 4,
  /** HTTP request failed (TTFB or body download). */
  HTTP_FAILED = 5,
  /** All probe runs failed. */
  ALL_RUNS_FAILED = 6,
  /** Internal/unexpected error. */
  INTERNAL_ERROR = 255,
}

/**
 * Base class for all Network Atonomy errors.
 * Provides a consistent way to identify error categories and their exit codes.
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
    super(message, ExitCode.DNS_FAILED, "dns");
    this.name = "DnsFailedError";
  }
}

/** Error thrown when TCP connection fails. */
export class TcpFailedError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.TCP_FAILED, "tcp");
    this.name = "TcpFailedError";
  }
}

/** Error thrown when TLS handshake fails. */
export class TlsFailedError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.TLS_FAILED, "tls");
    this.name = "TlsFailedError";
  }
}

/** Error thrown when HTTP request fails (TTFB or body download). */
export class HttpFailedError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.HTTP_FAILED, "http");
    this.name = "HttpFailedError";
  }
}

/** Error thrown when all probe runs fail. */
export class AllRunsFailedError extends NetworkAtonomyError {
  constructor(message: string) {
    super(message, ExitCode.ALL_RUNS_FAILED, "all");
    this.name = "AllRunsFailedError";
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