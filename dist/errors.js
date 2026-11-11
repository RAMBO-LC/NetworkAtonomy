/**
 * Standardized exit codes and error types for Network Atonomy CLI.
 */
export var ExitCode;
(function (ExitCode) {
    /** Successful execution. */
    ExitCode[ExitCode["OK"] = 0] = "OK";
    /** Invalid command-line arguments provided. */
    ExitCode[ExitCode["INVALID_ARGS"] = 1] = "INVALID_ARGS";
    /** Blocked address (SSRF guard). */
    ExitCode[ExitCode["BLOCKED_ADDRESS"] = 2] = "BLOCKED_ADDRESS";
    /** Network Failure: DNS resolution failed, connection refused, host unreachable, or TLS verification failed. */
    ExitCode[ExitCode["NETWORK_FAILURE"] = 3] = "NETWORK_FAILURE";
    /** Timeout: any stage timed out exceeding configured limits. */
    ExitCode[ExitCode["TIMEOUT"] = 4] = "TIMEOUT";
    /** Redirect loop detected. */
    ExitCode[ExitCode["REDIRECT_LOOP"] = 7] = "REDIRECT_LOOP";
    /** Too many redirects. */
    ExitCode[ExitCode["TOO_MANY_REDIRECTS"] = 8] = "TOO_MANY_REDIRECTS";
    /** Internal/unexpected error. */
    ExitCode[ExitCode["INTERNAL_ERROR"] = 255] = "INTERNAL_ERROR";
})(ExitCode || (ExitCode = {}));
/**
 * Base class for all Network Atonomy errors.
 *
 * Every subclass carries a single, immutable `exitCode` property. The CLI's
 * `mapErrorToExitCode` reads that property and never inspects the error
 * message, so a reworded message can never change the exit code.
 */
export class NetworkAtonomyError extends Error {
    exitCode;
    stage;
    constructor(message, exitCode, stage) {
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
    constructor(message) {
        super(message, ExitCode.INVALID_ARGS, "args");
        this.name = "InvalidArgsError";
    }
}
/** Error thrown when DNS resolution fails. */
export class DnsFailedError extends NetworkAtonomyError {
    constructor(message) {
        super(message, ExitCode.NETWORK_FAILURE, "dns");
        this.name = "DnsFailedError";
    }
}
/** Error thrown when TCP connection fails. */
export class TcpFailedError extends NetworkAtonomyError {
    constructor(message) {
        super(message, ExitCode.NETWORK_FAILURE, "tcp");
        this.name = "TcpFailedError";
    }
}
/** Error thrown when TLS handshake fails. */
export class TlsFailedError extends NetworkAtonomyError {
    constructor(message) {
        super(message, ExitCode.NETWORK_FAILURE, "tls");
        this.name = "TlsFailedError";
    }
}
/** Error thrown when HTTP request fails (TTFB or body download). */
export class HttpFailedError extends NetworkAtonomyError {
    constructor(message) {
        super(message, ExitCode.NETWORK_FAILURE, "http");
        this.name = "HttpFailedError";
    }
}
/** Error thrown when a timeout occurs. */
export class TimeoutError extends NetworkAtonomyError {
    constructor(message) {
        super(message, ExitCode.TIMEOUT, "timeout");
        this.name = "TimeoutError";
    }
}
/** Error thrown when all probe runs fail. */
export class AllRunsFailedError extends NetworkAtonomyError {
    constructor(message) {
        super(message, ExitCode.NETWORK_FAILURE, "all");
        this.name = "AllRunsFailedError";
    }
}
/** Error thrown when a redirect loop is detected. */
export class RedirectLoopError extends NetworkAtonomyError {
    constructor(message) {
        super(message, ExitCode.REDIRECT_LOOP, "redirect");
        this.name = "RedirectLoopError";
    }
}
/** Error thrown when too many redirects are encountered. */
export class TooManyRedirectsError extends NetworkAtonomyError {
    constructor(message) {
        super(message, ExitCode.TOO_MANY_REDIRECTS, "redirect");
        this.name = "TooManyRedirectsError";
    }
}
/** Error thrown for unexpected internal errors. */
export class InternalError extends NetworkAtonomyError {
    constructor(message) {
        super(message, ExitCode.INTERNAL_ERROR, "internal");
        this.name = "InternalError";
    }
}
/**
 * Maps an error to its corresponding ExitCode.
 * Returns INTERNAL_ERROR for unknown error types.
 */
export function getExitCode(error) {
    if (error instanceof NetworkAtonomyError) {
        return error.exitCode;
    }
    return ExitCode.INTERNAL_ERROR;
}
/**
 * Checks if an error is a NetworkAtonomyError (typed error).
 */
export function isNetworkAtonomyError(error) {
    return error instanceof NetworkAtonomyError;
}
