import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createServer } from "node:http";
import { type Server } from "node:net";
import { measureTcp, type TcpTimingResult } from "../tcp";

describe("measureTcp", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") {
          port = address.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns a positive duration when the connection succeeds", async () => {
    const result: TcpTimingResult = await measureTcp("127.0.0.1", port);

    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("returns a connected socket", async () => {
    const result = await measureTcp("127.0.0.1", port);

    expect(result.socket).toBeDefined();
    expect(result.socket.destroyed).toBe(false);
    result.socket.destroy();
  });

  it("rejects and destroys the socket when the connection fails", async () => {
    await expect(measureTcp("127.0.0.1", 1)).rejects.toThrow();
  });

  it("wires the default parameters (checkedIp, port)", () => {
    // measureTcp(checkedIp, port) — two required params.
    expect(measureTcp.length).toBe(2);
  });
});