/**
 * TCP connection timing stage.
 *
 * Measures the time spent establishing a TCP connection to an already-checked
 * IP address (`checkedIp`) on the given `port`. The timer starts immediately
 * before `net.connect()` is invoked and stops on the socket `'connect'`
 * event. The connected socket is returned so the next stage (TLS) can wrap it.
 *
 * The IP is assumed to have already passed the SSRF guard (see
 * `src/net/resolve.ts`); this stage performs no address validation of its own.
 *
 * On any connection error the socket is destroyed and the promise rejects,
 * leaving no dangling listeners or half-open sockets.
 */

import { performance } from "node:perf_hooks";
import { type Socket, connect as netConnect } from "node:net";

/**
 * Result of measuring the TCP connection stage.
 */
export interface TcpTimingResult {
  /** Duration of the TCP handshake in milliseconds (high-resolution). */
  durationMs: number;
  /** The connected socket, for use by the next stage (e.g. TLS wrap). */
  socket: Socket;
}

/**
 * Measure TCP connection time to an already-validated IP address.
 *
 * @param checkedIp - The IP address to connect to (already SSRF-checked).
 * @param port - The TCP port to connect to.
 * @returns The connection duration in ms and the connected socket.
 * @throws {Error} The socket `'error'` event error if the connection fails.
 *                   The socket is destroyed before rejecting.
 */
export async function measureTcp(checkedIp: string, port: number): Promise<TcpTimingResult> {
  return new Promise<TcpTimingResult>((resolve, reject) => {
    const start = performance.now();
    const socket = netConnect({ host: checkedIp, port });

    const cleanup = () => {
      socket.removeListener("connect", onConnect);
      socket.removeListener("error", onError);
    };

    const onConnect = () => {
      const end = performance.now();
      cleanup();
      resolve({ durationMs: end - start, socket });
    };

    const onError = (err: Error) => {
      cleanup();
      socket.destroy();
      reject(err);
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}