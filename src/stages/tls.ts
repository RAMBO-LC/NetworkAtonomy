/**
 * TLS handshake timing stage.
 *
 * Measures the time spent completing a TLS handshake over an existing TCP socket.
 * Starts immediately before `tls.connect({ socket, servername: hostname })` and stops
 * on the TLS socket `'secureConnect'` event. Returns the duration and secure socket.
 *
 * For HTTP URLs (non-TLS), returns duration 0 ms immediately along with the original socket.
 *
 * On any error during TLS connect, the socket is destroyed and the promise rejects.
 */

import { performance } from "node:perf_hooks";
import { type Socket as NetSocket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

/**
 * Result of measuring the TLS stage.
 */
export interface TlsTimingResult {
  /** Duration of the TLS handshake in milliseconds (high-resolution), or 0 for HTTP. */
  durationMs: number;
  /** The connected socket (TLSSocket for HTTPS, NetSocket for HTTP). */
  socket: NetSocket | TLSSocket;
}

/**
 * Options for measuring TLS handshake.
 */
export interface TlsTimingOptions {
  /** The open TCP socket from the previous TCP stage. */
  socket: NetSocket;
  /** The hostname for SNI (servername). */
  hostname: string;
  /** Protocol scheme, e.g. "https:" or "http:". Defaults to "https:". */
  protocol?: string;
  /** Whether to reject unauthorized certificates. Defaults to true. */
  rejectUnauthorized?: boolean;
}

/**
 * Measure TLS handshake duration over a TCP socket, or return 0 ms for HTTP.
 *
 * @param options - Socket, hostname, protocol, and TLS options.
 * @returns The TLS timing duration in ms and the secure (or original) socket.
 * @throws {Error} Socket or TLS error if TLS handshake fails. Socket is destroyed before rejecting.
 */
export async function measureTls(options: TlsTimingOptions): Promise<TlsTimingResult> {
  const { socket, hostname, protocol = "https:", rejectUnauthorized = true } = options;

  if (protocol === "http:" || protocol === "http") {
    return { durationMs: 0, socket };
  }

  return new Promise<TlsTimingResult>((resolve, reject) => {
    const start = performance.now();
    const tlsSocket = tlsConnect({
      socket,
      servername: hostname,
      rejectUnauthorized,
    });

    const cleanup = () => {
      tlsSocket.removeListener("secureConnect", onSecureConnect);
      tlsSocket.removeListener("error", onError);
    };

    const onSecureConnect = () => {
      const end = performance.now();
      cleanup();
      resolve({ durationMs: end - start, socket: tlsSocket });
    };

    const onError = (err: Error) => {
      cleanup();
      tlsSocket.destroy();
      reject(err);
    };

    tlsSocket.once("secureConnect", onSecureConnect);
    tlsSocket.once("error", onError);
  });
}
