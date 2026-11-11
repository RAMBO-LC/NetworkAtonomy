/**
 * HTTP request timing stage.
 *
 * Sends an HTTP GET request over an existing socket (plain TCP for HTTP,
 * TLS-wrapped for HTTPS) and measures:
 *   - TTFB: Time from request write completion to first response byte/headers.
 *   - Body: Time from first response byte to stream 'end', respecting maxBody cap.
 *
 * The socket is assumed to be already connected (and TLS-wrapped if HTTPS).
 * On any error, the socket is destroyed and the promise rejects.
 */

import { performance } from "node:perf_hooks";
import { type Socket as NetSocket } from "node:net";
import { type TLSSocket } from "node:tls";

/** Union of plain and TLS sockets for HTTP over either transport. */
export type HttpSocket = NetSocket | TLSSocket;

/** HTTP timing result containing TTFB and body download durations. */
export interface HttpTimingResult {
  /** Time to First Byte in milliseconds (high-resolution). */
  ttfbMs: number;
  /** Body download time in milliseconds (high-resolution). */
  bodyMs: number;
  /** HTTP status code from the response. */
  statusCode: number;
  /** Total response body bytes received (capped at maxBody). */
  bytesReceived: number;
  /** Location header value if present (for redirects). */
  location?: string;
}

/** Options for the HTTP timing measurement. */
export interface HttpTimingOptions {
  /** The connected socket (plain for HTTP, TLS-wrapped for HTTPS). */
  socket: HttpSocket;
  /** The hostname for the Host header. */
  hostname: string;
  /** The request path including query string. Defaults to "/". */
  path?: string;
  /** The port for the Host header (if non-standard). */
  port?: number;
  /** Maximum body bytes to read before cutting off. Defaults to 10 MiB. */
  maxBody?: number;
  /** Protocol scheme for logging/Host header. Defaults to "http:". */
  protocol?: string;
}

/** Default maximum body size: 10 MiB. */
export const DEFAULT_MAX_BODY = 10 * 1024 * 1024;

/**
 * Build the HTTP GET request headers as a Buffer.
 */
function buildRequest(hostname: string, path: string, port?: number, protocol = "http:"): Buffer {
  const hostHeader = port && port !== 80 && port !== 443 ? `${hostname}:${port}` : hostname;
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: ${hostHeader}`,
    "Connection: close",
    "User-Agent: reqanatomy/1.0",
    "Accept: */*",
    "",
    "",
  ];
  return Buffer.from(lines.join("\r\n"));
}

/**
 * Measure HTTP GET request timing (TTFB and body download) over an existing socket.
 *
 * @param options - Socket, hostname, path, port, maxBody, and protocol.
 * @returns TTFB duration, body duration, status code, and bytes received.
 * @throws {Error} On socket error, timeout, or invalid HTTP response. Socket is destroyed.
 */
export async function measureHttp(options: HttpTimingOptions): Promise<HttpTimingResult> {
  const {
    socket,
    hostname,
    path = "/",
    port,
    maxBody = DEFAULT_MAX_BODY,
    protocol = "http:",
  } = options;

  return new Promise<HttpTimingResult>((resolve, reject) => {
    const requestBuffer = buildRequest(hostname, path, port, protocol);

    let ttfbMs: number | null = null;
      let ttfbStartMs: number | null = null;
      let bodyStartMs: number | null = null;
    let bytesReceived = 0;
    let statusCode = 0;
    let headersComplete = false;
    let headerBuffer = Buffer.alloc(0);
    let location: string | undefined;

    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("end", onEnd);
      socket.removeListener("close", onClose);
    };

    const onError = (err: Error) => {
      cleanup();
      if (!socket.destroyed) {
        socket.destroy();
      }
      reject(err);
    };

    const onClose = () => {
      cleanup();
      if (ttfbMs === null) {
        reject(new Error("Socket closed before receiving response"));
      }
    };

    const onEnd = () => {
      cleanup();
      if (!socket.destroyed) {
        socket.destroy();
      }
      if (ttfbMs === null || bodyStartMs === null) {
        reject(new Error("Response ended before headers received"));
        return;
      }
      const bodyMs = performance.now() - bodyStartMs;
      resolve({
        ttfbMs,
        bodyMs,
        statusCode,
        bytesReceived,
        location,
      });
    };

    const onData = (chunk: Buffer) => {
      const now = performance.now();

      if (ttfbMs === null) {
        // First data received - this is TTFB
        // ttfbStartMs is set in the write callback when request is fully written
        ttfbMs = now - ttfbStartMs!;
        bodyStartMs = now;
      }

      if (!headersComplete) {
        // Accumulate headers
        headerBuffer = Buffer.concat([headerBuffer, chunk]);

        // Check for end of headers (\r\n\r\n)
        const headerEnd = headerBuffer.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          headersComplete = true;
          // Parse status line
          const headerText = headerBuffer.subarray(0, headerEnd).toString("utf8");
          const statusLine = headerText.split("\r\n")[0] ?? "";
          const match = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})/);
          if (match && match[1]) {
            statusCode = parseInt(match[1], 10);
          } else {
            // Invalid status line - but we continue
            statusCode = 0;
          }

          // Extract Location header
          const locationMatch = headerText.match(/^Location:\s*(.+)$/im);
          if (locationMatch && locationMatch[1]) {
            location = locationMatch[1].trim();
          }

          // Body starts after headers
          const bodyStart = headerEnd + 4;
          if (bodyStart < chunk.length) {
            const bodyChunk = chunk.subarray(bodyStart);
            bytesReceived += bodyChunk.length;

            // Check maxBody cap for body in first chunk
            if (bytesReceived >= maxBody) {
              cleanup();
              socket.destroy();
              const bodyMs = performance.now() - bodyStartMs!;
              resolve({
                ttfbMs: ttfbMs!,
                bodyMs,
                statusCode,
                bytesReceived: maxBody,
                location,
              });
              return;
            }
          }
        }
        // If headers not complete yet, all data is header data - don't count toward body
        return;
      }

      // Headers complete - count body bytes
      bytesReceived += chunk.length;

      // Check maxBody cap
      if (bytesReceived >= maxBody) {
        // We've hit the cap - destroy socket to stop reading
        cleanup();
        socket.destroy();
        const bodyMs = performance.now() - bodyStartMs!;
        resolve({
                        ttfbMs: ttfbMs!,
                        bodyMs,
                        statusCode,
                        bytesReceived: maxBody,
                        location,
                      });
      }
    };

    // Write request and start timing
      const writeStart = performance.now();
      socket.write(requestBuffer, (err) => {
        if (err) {
          cleanup();
          socket.destroy();
          reject(err);
          return;
        }
        // TTFB timing starts after request is fully written
        ttfbStartMs = performance.now();
      });

    socket.once("error", onError);
    socket.once("end", onEnd);
    socket.once("close", onClose);
    socket.on("data", onData);
  });
}