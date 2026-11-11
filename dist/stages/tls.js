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
import {} from "node:net";
import { connect as tlsConnect } from "node:tls";
/**
 * Measure TLS handshake duration over a TCP socket, or return 0 ms for HTTP.
 *
 * @param options - Socket, hostname, protocol, and TLS options.
 * @returns The TLS timing duration in ms and the secure (or original) socket.
 * @throws {Error} Socket or TLS error if TLS handshake fails. Socket is destroyed before rejecting.
 */
export async function measureTls(options) {
    const { socket, hostname, protocol = "https:", rejectUnauthorized = true } = options;
    if (protocol === "http:" || protocol === "http") {
        return { durationMs: 0, socket };
    }
    return new Promise((resolve, reject) => {
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
        const onError = (err) => {
            cleanup();
            tlsSocket.destroy();
            reject(err);
        };
        tlsSocket.once("secureConnect", onSecureConnect);
        tlsSocket.once("error", onError);
    });
}
