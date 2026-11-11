#!/usr/bin/env node
/**
 * Curl comparison script for TTFB bug investigation.
 * Runs curl against the same local fixture servers and compares with tool output.
 */

import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

// Delayed response server - waits 300ms before sending headers
const delayedServer = createHttpServer((req, res) => {
  setTimeout(() => {
    res.writeHead(200, { "Content-Length": "13" });
    res.end("Hello, World!");
  }, 300);
});

// Redirect server - returns 301 with Location header
let delayedUrlForRedirect = "";
const redirectServer = createHttpServer((req, res) => {
  res.writeHead(301, {
    "Location": delayedUrlForRedirect,
    "Content-Length": "0",
  });
  res.end();
});

async function startServer(server: HttpServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
      }
    });
  });
}

async function runCurl(url: string): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const curl = spawn("curl", [
      "-w",
      "time_namelookup=%{time_namelookup}\ntime_connect=%{time_connect}\ntime_appconnect=%{time_appconnect}\ntime_pretransfer=%{time_pretransfer}\ntime_starttransfer=%{time_starttransfer}\ntime_total=%{time_total}\n",
      "-s",
      "-o",
      "/dev/null",
      url,
    ]);

    let stdout = "";
    let stderr = "";

    curl.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    curl.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    curl.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`curl exited with code ${code}: ${stderr}`));
        return;
      }
      const result: Record<string, number> = {};
      for (const line of stdout.trim().split("\n")) {
        const [key, value] = line.split("=");
        result[key] = parseFloat(value) * 1000; // Convert to ms
      }
      resolve(result);
    });

    curl.on("error", reject);
  });
}

async function runTool(url: string, runs: number = 5): Promise<{
  stages: { dns: { medianMs: number }; tcp: { medianMs: number }; tls: { medianMs: number }; ttfb: { medianMs: number }; body: { medianMs: number } };
  total: { medianMs: number };
}> {
  // Run the tool via npx tsx
  const { spawn } = await import("node:child_process");
  
  return new Promise((resolve, reject) => {
    const tool = spawn("npx", [
      "tsx",
      "src/cli.ts",
      url,
      "--runs",
      String(runs),
      "--json",
      "--allow-private",
    ], {
      cwd: "/Users/rajambolikar/Desktop/NetworkAtonomy",
    });

    let stdout = "";
    let stderr = "";

    tool.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    tool.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    tool.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tool exited with code ${code}: ${stderr}`));
        return;
      }
      // Parse JSON from stdout
      const lines = stdout.trim().split("\n");
      let startIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith("{")) {
          startIdx = i;
          break;
        }
      }
      if (startIdx === -1) {
        reject(new Error("No JSON output found"));
        return;
      }
      const jsonStr = lines.slice(startIdx).join("\n");
      const parsed = JSON.parse(jsonStr);
      resolve(parsed);
    });

    tool.on("error", reject);
  });
}

async function main() {
  console.log("Starting fixture servers...");

  await startServer(delayedServer);
  const delayedPort = (delayedServer.address() as any).port;
  
  // Update redirect server's Location header
  delayedUrlForRedirect = `http://127.0.0.1:${delayedPort}/redirected`;
  
  await startServer(redirectServer);
  const redirectPort = (redirectServer.address() as any).port;

  console.log(`Delayed server: http://127.0.0.1:${delayedPort} (300ms delay)`);
  console.log(`Redirect server: http://127.0.0.1:${redirectPort} (301 -> delayed server)`);
  console.log("");

  // Test 1: Delayed server
  console.log("=== Test 1: Delayed Server (300ms artificial delay) ===");
  const delayedUrl = `http://127.0.0.1:${delayedPort}`;

  console.log("\n--- curl ---");
  const curlDelayed = await runCurl(delayedUrl);
  console.log("time_namelookup (DNS):", curlDelayed.time_namelookup?.toFixed(2), "ms");
  console.log("time_connect (TCP):", curlDelayed.time_connect?.toFixed(2), "ms");
  console.log("time_appconnect (TLS):", curlDelayed.time_appconnect?.toFixed(2), "ms");
  console.log("time_pretransfer:", curlDelayed.time_pretransfer?.toFixed(2), "ms");
  console.log("time_starttransfer (TTFB):", curlDelayed.time_starttransfer?.toFixed(2), "ms");
  console.log("time_total:", curlDelayed.time_total?.toFixed(2), "ms");

  // Calculate per-stage from cumulative
  const curlDns = curlDelayed.time_namelookup || 0;
  const curlTcp = (curlDelayed.time_connect || 0) - curlDns;
  const curlTls = (curlDelayed.time_appconnect || 0) - (curlDelayed.time_connect || 0);
  const curlTtfb = (curlDelayed.time_starttransfer || 0) - (curlDelayed.time_pretransfer || 0);
  // Note: curl's time_pretransfer includes TLS for HTTPS, but for HTTP it's same as time_connect
  // For HTTP, TTFB = time_starttransfer - time_pretransfer
  // But time_pretransfer = time_connect for HTTP
  
  console.log("\n--- Calculated per-stage (curl) ---");
  console.log("DNS:", curlDns.toFixed(2), "ms");
  console.log("TCP:", curlTcp.toFixed(2), "ms");
  console.log("TLS:", curlTls.toFixed(2), "ms");
  console.log("TTFB:", curlTtfb.toFixed(2), "ms");

  console.log("\n--- Tool ---");
  const toolDelayed = await runTool(delayedUrl, 5);
  console.log("DNS:", toolDelayed.stages.dns.medianMs.toFixed(2), "ms");
  console.log("TCP:", toolDelayed.stages.tcp.medianMs.toFixed(2), "ms");
  console.log("TLS:", toolDelayed.stages.tls.medianMs.toFixed(2), "ms");
  console.log("TTFB:", toolDelayed.stages.ttfb.medianMs.toFixed(2), "ms");
  console.log("Body:", toolDelayed.stages.body.medianMs.toFixed(2), "ms");
  console.log("Total:", toolDelayed.total.medianMs.toFixed(2), "ms");

  console.log("\n--- Comparison ---");
  console.log("DNS: tool=" + toolDelayed.stages.dns.medianMs.toFixed(2) + " vs curl=" + curlDns.toFixed(2) + " (diff: " + (toolDelayed.stages.dns.medianMs - curlDns).toFixed(2) + ")");
  console.log("TCP: tool=" + toolDelayed.stages.tcp.medianMs.toFixed(2) + " vs curl=" + curlTcp.toFixed(2) + " (diff: " + (toolDelayed.stages.tcp.medianMs - curlTcp).toFixed(2) + ")");
  console.log("TLS: tool=" + toolDelayed.stages.tls.medianMs.toFixed(2) + " vs curl=" + curlTls.toFixed(2) + " (diff: " + (toolDelayed.stages.tls.medianMs - curlTls).toFixed(2) + ")");
  console.log("TTFB: tool=" + toolDelayed.stages.ttfb.medianMs.toFixed(2) + " vs curl=" + curlTtfb.toFixed(2) + " (diff: " + (toolDelayed.stages.ttfb.medianMs - curlTtfb).toFixed(2) + ")");

  // Test 2: Redirect server
  console.log("\n\n=== Test 2: Redirect Server (301, no follow) ===");
  const redirectUrl = `http://127.0.0.1:${redirectPort}`;

  console.log("\n--- curl (no follow) ---");
  const curlRedirect = await runCurl(redirectUrl);
  console.log("time_starttransfer (TTFB):", curlRedirect.time_starttransfer?.toFixed(2), "ms");
  console.log("time_total:", curlRedirect.time_total?.toFixed(2), "ms");

  console.log("\n--- Tool ---");
  const toolRedirect = await runTool(redirectUrl, 3);
  console.log("TTFB:", toolRedirect.stages.ttfb.medianMs.toFixed(2), "ms");
  console.log("Status Code:", toolRedirect.statusCode);
  console.log("Total:", toolRedirect.total.medianMs.toFixed(2), "ms");

  // Cleanup
  delayedServer.close();
  redirectServer.close();

  console.log("\n\n=== SUMMARY ===");
  console.log("If tool TTFB ≈ 300ms (matching server delay), the TTFB bug is FIXED.");
  console.log("If tool TTFB >> 300ms (e.g., ~1000ms), the bug is NOT fixed.");
  console.log("Redirect test: Tool should report 301 status and fast TTFB (no follow).");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});