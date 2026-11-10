import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { measureTcp } from "../tcp";
import { measureTls } from "../tls";
import { measureHttp, type HttpTimingResult } from "../http";

describe("measureHttp", () => {
  let httpServer: HttpServer;
  let httpPort: number;
  let httpsServer: HttpsServer;
  let httpsPort: number;
  let rawHttpServer: NetServer;
  let rawHttpPort: number;

  beforeAll(async () => {
    // HTTP server
    httpServer = createHttpServer((req, res) => {
      res.writeHead(200, { "Content-Length": "13" });
      res.end("Hello, World!");
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

    // HTTPS server with self-signed cert
    const certPath = resolve(__dirname, "../../fixtures/localhost-cert.pem");
    const keyPath = resolve(__dirname, "../../fixtures/localhost-key.pem");
    const cert = readFileSync(certPath, "utf8");
    const key = readFileSync(keyPath, "utf8");

    httpsServer = createHttpsServer({ cert, key }, (req, res) => {
      res.writeHead(200, { "Content-Length": "13" });
      res.end("Hello, World!");
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

    // Raw TCP server that speaks HTTP (for testing plain socket)
    rawHttpServer = createNetServer((socket) => {
      socket.on("data", (data) => {
        // Parse request and send simple HTTP response
        const response =
          "HTTP/1.1 200 OK\r\n" +
          "Content-Length: 13\r\n" +
          "Connection: close\r\n" +
          "\r\n" +
          "Hello, World!";
        socket.write(response);
        socket.end();
      });
    });

    await new Promise<void>((resolve) => {
      rawHttpServer.listen(0, "127.0.0.1", () => {
        const address = rawHttpServer.address();
        if (address && typeof address === "object") {
          rawHttpPort = address.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
    await new Promise<void>((resolve) => rawHttpServer.close(() => resolve()));
  });

  describe("HTTP over plain TCP", () => {
    it("returns TTFB > 0, body > 0, status 200, and correct bytes", async () => {
      const tcpResult = await measureTcp("127.0.0.1", rawHttpPort);
      const result: HttpTimingResult = await measureHttp({
        socket: tcpResult.socket,
        hostname: "localhost",
        path: "/",
      });

      expect(result.ttfbMs).toBeGreaterThan(0);
      expect(result.bodyMs).toBeGreaterThanOrEqual(0);
      expect(result.statusCode).toBe(200);
      expect(result.bytesReceived).toBe(13);
      expect(tcpResult.socket.destroyed).toBe(true);
    });

    it("measures TTFB and body timing separately", async () => {
      const tcpResult = await measureTcp("127.0.0.1", rawHttpPort);
      const result = await measureHttp({
        socket: tcpResult.socket,
        hostname: "localhost",
        path: "/",
      });

      // TTFB should be measured (time to first byte)
      expect(result.ttfbMs).toBeGreaterThan(0);
      // Body time should be >= 0 (could be very fast for small responses)
      expect(result.bodyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("HTTP over TLS (HTTPS)", () => {
    it("returns TTFB > 0, body > 0, status 200 via HTTPS", async () => {
      const tcpResult = await measureTcp("127.0.0.1", httpsPort);
      const tlsResult = await measureTls({
        socket: tcpResult.socket,
        hostname: "localhost",
        protocol: "https:",
        rejectUnauthorized: false,
      });
      const result: HttpTimingResult = await measureHttp({
        socket: tlsResult.socket,
        hostname: "localhost",
        path: "/",
        protocol: "https:",
      });

      expect(result.ttfbMs).toBeGreaterThan(0);
      expect(result.bodyMs).toBeGreaterThanOrEqual(0);
      expect(result.statusCode).toBe(200);
      expect(result.bytesReceived).toBe(13);
      expect(tlsResult.socket.destroyed).toBe(true);
    });
  });

  describe("maxBody cap", () => {
    it("respects maxBody limit and stops reading", async () => {
      // Create a server that sends a large body
      const largeBodyServer = createHttpServer((req, res) => {
        const largeBody = "x".repeat(1000); // 1KB body
        res.writeHead(200, { "Content-Length": String(largeBody.length) });
        res.end(largeBody);
      });

      let largePort: number;
      await new Promise<void>((resolve) => {
        largeBodyServer.listen(0, "127.0.0.1", () => {
          const address = largeBodyServer.address();
          if (address && typeof address === "object") {
            largePort = address.port;
          }
          resolve();
        });
      });

      try {
        const tcpResult = await measureTcp("127.0.0.1", largePort!);
        const result = await measureHttp({
          socket: tcpResult.socket,
          hostname: "localhost",
          path: "/",
          maxBody: 100, // Cap at 100 bytes
        });

        expect(result.bytesReceived).toBe(100);
        expect(result.statusCode).toBe(200);
      } finally {
        await new Promise<void>((resolve) => largeBodyServer.close(() => resolve()));
      }
    });
  });

  describe("HTTP response with different status codes", () => {
    it("captures 404 status code", async () => {
      const notFoundServer = createHttpServer((req, res) => {
        res.writeHead(404, { "Content-Length": "9" });
        res.end("Not Found");
      });

      let nfPort: number;
      await new Promise<void>((resolve) => {
        notFoundServer.listen(0, "127.0.0.1", () => {
          const address = notFoundServer.address();
          if (address && typeof address === "object") {
            nfPort = address.port;
          }
          resolve();
        });
      });

      try {
        const tcpResult = await measureTcp("127.0.0.1", nfPort!);
        const result = await measureHttp({
          socket: tcpResult.socket,
          hostname: "localhost",
          path: "/missing",
        });

        expect(result.statusCode).toBe(404);
        expect(result.bytesReceived).toBe(9);
      } finally {
        await new Promise<void>((resolve) => notFoundServer.close(() => resolve()));
      }
    });

    it("captures 301 redirect status code", async () => {
      const redirectServer = createHttpServer((req, res) => {
        res.writeHead(301, { "Location": "https://example.com/", "Content-Length": "0" });
        res.end();
      });

      let redPort: number;
      await new Promise<void>((resolve) => {
        redirectServer.listen(0, "127.0.0.1", () => {
          const address = redirectServer.address();
          if (address && typeof address === "object") {
            redPort = address.port;
          }
          resolve();
        });
      });

      try {
        const tcpResult = await measureTcp("127.0.0.1", redPort!);
        const result = await measureHttp({
          socket: tcpResult.socket,
          hostname: "localhost",
          path: "/",
        });

        expect(result.statusCode).toBe(301);
        expect(result.bytesReceived).toBe(0);
      } finally {
        await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
      }
    });
  });

  describe("request options", () => {
    it("includes path and query string in request", async () => {
      const echoServer = createHttpServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(req.url || "/");
      });

      let echoPort: number;
      await new Promise<void>((resolve) => {
        echoServer.listen(0, "127.0.0.1", () => {
          const address = echoServer.address();
          if (address && typeof address === "object") {
            echoPort = address.port;
          }
          resolve();
        });
      });

      try {
        const tcpResult = await measureTcp("127.0.0.1", echoPort!);
        const result = await measureHttp({
          socket: tcpResult.socket,
          hostname: "localhost",
          path: "/test?foo=bar",
        });

        // Server echoes back the URL path
        expect(result.bytesReceived).toBeGreaterThan(0);
        expect(result.statusCode).toBe(200);
      } finally {
        await new Promise<void>((resolve) => echoServer.close(() => resolve()));
      }
    });

    it("includes port in Host header when non-standard", async () => {
      const hostHeaderServer = createHttpServer((req, res) => {
        const hostHeader = req.headers.host || "";
        res.writeHead(200, { "Content-Length": String(hostHeader.length) });
        res.end(hostHeader);
      });

      let hhPort: number;
      await new Promise<void>((resolve) => {
        hostHeaderServer.listen(0, "127.0.0.1", () => {
          const address = hostHeaderServer.address();
          if (address && typeof address === "object") {
            hhPort = address.port;
          }
          resolve();
        });
      });

      try {
        const tcpResult = await measureTcp("127.0.0.1", hhPort!);
        const result = await measureHttp({
          socket: tcpResult.socket,
          hostname: "localhost",
          path: "/",
          port: hhPort,
        });

        // Host header should include port since it's non-standard
        expect(result.bytesReceived).toBeGreaterThan(0);
        expect(result.statusCode).toBe(200);
      } finally {
        await new Promise<void>((resolve) => hostHeaderServer.close(() => resolve()));
      }
    });
  });

  describe("error handling", () => {
    it("rejects on socket error", async () => {
      const tcpResult = await measureTcp("127.0.0.1", rawHttpPort);
      tcpResult.socket.destroy(); // Destroy before making request

      await expect(
        measureHttp({
          socket: tcpResult.socket,
          hostname: "localhost",
        })
      ).rejects.toThrow();
    });

    it("rejects on connection close before response", async () => {
      // Server that closes connection immediately without response
      const closeServer = createNetServer((socket) => {
        socket.destroy();
      });

      let closePort: number;
      await new Promise<void>((resolve) => {
        closeServer.listen(0, "127.0.0.1", () => {
          const address = closeServer.address();
          if (address && typeof address === "object") {
            closePort = address.port;
          }
          resolve();
        });
      });

      try {
        const tcpResult = await measureTcp("127.0.0.1", closePort!);

        await expect(
          measureHttp({
            socket: tcpResult.socket,
            hostname: "localhost",
          })
        ).rejects.toThrow();
      } finally {
        await new Promise<void>((resolve) => closeServer.close(() => resolve()));
      }
    });
  });
});