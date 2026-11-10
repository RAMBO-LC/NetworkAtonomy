/**
 * Tests for error types and exit codes.
 */

import { describe, it, expect } from "vitest";
import {
  ExitCode,
  NetworkAtonomyError,
  InvalidArgsError,
  DnsFailedError,
  TcpFailedError,
  TlsFailedError,
  HttpFailedError,
  AllRunsFailedError,
  InternalError,
  getExitCode,
  isNetworkAtonomyError,
} from "../errors";

describe("ExitCode enum", () => {
  it("has correct values", () => {
    expect(ExitCode.OK).toBe(0);
    expect(ExitCode.INVALID_ARGS).toBe(1);
    expect(ExitCode.DNS_FAILED).toBe(2);
    expect(ExitCode.TCP_FAILED).toBe(3);
    expect(ExitCode.TLS_FAILED).toBe(4);
    expect(ExitCode.HTTP_FAILED).toBe(5);
    expect(ExitCode.ALL_RUNS_FAILED).toBe(6);
    expect(ExitCode.INTERNAL_ERROR).toBe(255);
  });

  it("has unique values", () => {
    const values = Object.values(ExitCode).filter((v) => typeof v === "number");
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });
});

describe("NetworkAtonomyError base class", () => {
  it("sets exitCode and stage properties", () => {
    class TestError extends NetworkAtonomyError {
      constructor() {
        super("test message", ExitCode.INTERNAL_ERROR, "test");
      }
    }

    const error = new TestError();
    expect(error.message).toBe("test message");
    expect(error.exitCode).toBe(ExitCode.INTERNAL_ERROR);
    expect(error.stage).toBe("test");
    expect(error.name).toBe("TestError");
  });

  it("is instanceof Error", () => {
    class TestError extends NetworkAtonomyError {
      constructor() {
        super("test", ExitCode.INTERNAL_ERROR, "test");
      }
    }

    const error = new TestError();
    expect(error instanceof Error).toBe(true);
    expect(error instanceof NetworkAtonomyError).toBe(true);
  });
});

describe("InvalidArgsError", () => {
  it("has correct exit code and stage", () => {
    const error = new InvalidArgsError("Invalid argument");
    expect(error.exitCode).toBe(ExitCode.INVALID_ARGS);
    expect(error.stage).toBe("args");
    expect(error.name).toBe("InvalidArgsError");
  });

  it("is instanceof NetworkAtonomyError", () => {
    const error = new InvalidArgsError("test");
    expect(isNetworkAtonomyError(error)).toBe(true);
  });
});

describe("DnsFailedError", () => {
  it("has correct exit code and stage", () => {
    const error = new DnsFailedError("DNS resolution failed");
    expect(error.exitCode).toBe(ExitCode.DNS_FAILED);
    expect(error.stage).toBe("dns");
    expect(error.name).toBe("DnsFailedError");
  });

  it("is instanceof NetworkAtonomyError", () => {
    const error = new DnsFailedError("test");
    expect(isNetworkAtonomyError(error)).toBe(true);
  });
});

describe("TcpFailedError", () => {
  it("has correct exit code and stage", () => {
    const error = new TcpFailedError("Connection refused");
    expect(error.exitCode).toBe(ExitCode.TCP_FAILED);
    expect(error.stage).toBe("tcp");
    expect(error.name).toBe("TcpFailedError");
  });

  it("is instanceof NetworkAtonomyError", () => {
    const error = new TcpFailedError("test");
    expect(isNetworkAtonomyError(error)).toBe(true);
  });
});

describe("TlsFailedError", () => {
  it("has correct exit code and stage", () => {
    const error = new TlsFailedError("TLS handshake failed");
    expect(error.exitCode).toBe(ExitCode.TLS_FAILED);
    expect(error.stage).toBe("tls");
    expect(error.name).toBe("TlsFailedError");
  });

  it("is instanceof NetworkAtonomyError", () => {
    const error = new TlsFailedError("test");
    expect(isNetworkAtonomyError(error)).toBe(true);
  });
});

describe("HttpFailedError", () => {
  it("has correct exit code and stage", () => {
    const error = new HttpFailedError("HTTP request failed");
    expect(error.exitCode).toBe(ExitCode.HTTP_FAILED);
    expect(error.stage).toBe("http");
    expect(error.name).toBe("HttpFailedError");
  });

  it("is instanceof NetworkAtonomyError", () => {
    const error = new HttpFailedError("test");
    expect(isNetworkAtonomyError(error)).toBe(true);
  });
});

describe("AllRunsFailedError", () => {
  it("has correct exit code and stage", () => {
    const error = new AllRunsFailedError("All runs failed");
    expect(error.exitCode).toBe(ExitCode.ALL_RUNS_FAILED);
    expect(error.stage).toBe("all");
    expect(error.name).toBe("AllRunsFailedError");
  });

  it("is instanceof NetworkAtonomyError", () => {
    const error = new AllRunsFailedError("test");
    expect(isNetworkAtonomyError(error)).toBe(true);
  });
});

describe("InternalError", () => {
  it("has correct exit code and stage", () => {
    const error = new InternalError("Internal error");
    expect(error.exitCode).toBe(ExitCode.INTERNAL_ERROR);
    expect(error.stage).toBe("internal");
    expect(error.name).toBe("InternalError");
  });

  it("is instanceof NetworkAtonomyError", () => {
    const error = new InternalError("test");
    expect(isNetworkAtonomyError(error)).toBe(true);
  });
});

describe("getExitCode", () => {
  it("returns correct exit code for NetworkAtonomyError instances", () => {
    expect(getExitCode(new InvalidArgsError("test"))).toBe(ExitCode.INVALID_ARGS);
    expect(getExitCode(new DnsFailedError("test"))).toBe(ExitCode.DNS_FAILED);
    expect(getExitCode(new TcpFailedError("test"))).toBe(ExitCode.TCP_FAILED);
    expect(getExitCode(new TlsFailedError("test"))).toBe(ExitCode.TLS_FAILED);
    expect(getExitCode(new HttpFailedError("test"))).toBe(ExitCode.HTTP_FAILED);
    expect(getExitCode(new AllRunsFailedError("test"))).toBe(ExitCode.ALL_RUNS_FAILED);
    expect(getExitCode(new InternalError("test"))).toBe(ExitCode.INTERNAL_ERROR);
  });

  it("returns INTERNAL_ERROR for unknown errors", () => {
    expect(getExitCode(new Error("unknown"))).toBe(ExitCode.INTERNAL_ERROR);
    expect(getExitCode("string error")).toBe(ExitCode.INTERNAL_ERROR);
    expect(getExitCode(null)).toBe(ExitCode.INTERNAL_ERROR);
    expect(getExitCode(undefined)).toBe(ExitCode.INTERNAL_ERROR);
    expect(getExitCode(123)).toBe(ExitCode.INTERNAL_ERROR);
    expect(getExitCode({})).toBe(ExitCode.INTERNAL_ERROR);
  });
});

describe("isNetworkAtonomyError", () => {
  it("returns true for NetworkAtonomyError instances", () => {
    expect(isNetworkAtonomyError(new InvalidArgsError("test"))).toBe(true);
    expect(isNetworkAtonomyError(new DnsFailedError("test"))).toBe(true);
    expect(isNetworkAtonomyError(new TcpFailedError("test"))).toBe(true);
    expect(isNetworkAtonomyError(new TlsFailedError("test"))).toBe(true);
    expect(isNetworkAtonomyError(new HttpFailedError("test"))).toBe(true);
    expect(isNetworkAtonomyError(new AllRunsFailedError("test"))).toBe(true);
    expect(isNetworkAtonomyError(new InternalError("test"))).toBe(true);
  });

  it("returns false for non-NetworkAtonomyError values", () => {
    expect(isNetworkAtonomyError(new Error("test"))).toBe(false);
    expect(isNetworkAtonomyError("string")).toBe(false);
    expect(isNetworkAtonomyError(null)).toBe(false);
    expect(isNetworkAtonomyError(undefined)).toBe(false);
    expect(isNetworkAtonomyError(123)).toBe(false);
    expect(isNetworkAtonomyError({})).toBe(false);
  });
});