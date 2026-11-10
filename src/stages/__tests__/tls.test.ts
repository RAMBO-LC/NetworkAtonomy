import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { createServer as createHttpServer, type Server as HttpServer } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { measureTcp } from "../tcp";
import { measureTls, type TlsTimingResult } from "../tls";

describe("measureTls", () => {
  let httpsServer: HttpsServer;
  let httpsPort: number;
  let httpServer: HttpServer;
  let httpPort: number;

  beforeAll(async () => {
    // Use pre-generated self-signed certificate for localhost
    const certPath = resolve(__dirname, "../../fixtures/localhost-cert.pem");
    const keyPath = resolve(__dirname, "../../fixtures/localhost-key.pem");
    const cert = readFileSync(certPath, "utf8");
    const key = readFileSync(keyPath, "utf8");

    // Create local HTTPS server
    httpsServer = createHttpsServer({ cert, key }, (req, res) => {
      res.writeHead(200);
      res.end("secure ok");
    });

    await new Promise<void>((resolve) => {
      httpsServer.listen(0, "127.0.0.1", () => {
        const address = httpsServer.address();
        if (address && typeof address === "object") {
          httpsPort = address.port;
        }
        resolve();
      });
    });

    // Create local HTTP server
    httpServer = createHttpServer((socket) => {
      socket.on("data", () => {
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
      });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => {
        const address = httpServer.address();
        if (address && typeof address === "object") {
          httpPort = address.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("returns 0 ms immediately for HTTP (non-TLS)", async () => {
    const tcpResult = await measureTcp("127.0.0.1", httpPort);
    const tlsResult: TlsTimingResult = await measureTls({
      socket: tcpResult.socket,
      hostname: "localhost",
      protocol: "http:",
    });

    expect(tlsResult.durationMs).toBe(0);
    expect(tlsResult.socket).toBe(tcpResult.socket);
    tlsResult.socket.destroy();
  });

  it("returns ms > 0 and secure socket for HTTPS (TLS)", async () => {
    const tcpResult = await measureTcp("127.0.0.1", httpsPort);
    const tlsResult: TlsTimingResult = await measureTls({
      socket: tcpResult.socket,
      hostname: "localhost",
      protocol: "https:",
      rejectUnauthorized: false, // self-signed cert in test
    });

    expect(tlsResult.durationMs).toBeGreaterThan(0);
    expect(tlsResult.socket).toBeDefined();
    expect(tlsResult.socket.destroyed).toBe(false);
    tlsResult.socket.destroy();
  });

  it("rejects and destroys socket on TLS error (e.g., unauthorized cert when rejectUnauthorized is true)", async () => {
    const tcpResult = await measureTcp("127.0.0.1", httpsPort);

    await expect(
      measureTls({
        socket: tcpResult.socket,
        hostname: "localhost",
        protocol: "https:",
        rejectUnauthorized: true,
      })
    ).rejects.toThrow();

    expect(tcpResult.socket.destroyed).toBe(true);
  });
});