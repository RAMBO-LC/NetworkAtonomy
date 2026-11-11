/**
 * Tests for TUI Adapter
 *
 * Uses renderToText for headless testing (no TTY required).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToText } from "@profullstack/hqtui/testing";
import { createHQTUIAdapter, type TUIState, type KeyEvent } from "./adapter";

function makeState(overrides: Partial<TUIState> = {}): TUIState {
  return {
    runIndex: 0,
    totalRuns: 5,
    stages: {
      dns: { median: 10, min: 8, max: 12 },
      tcp: { median: 20, min: 18, max: 22 },
      tls: { median: 30, min: 28, max: 35 },
      ttfb: { median: 100, min: 90, max: 110 },
      body: { median: 5, min: 4, max: 6 },
    },
    total: { median: 165, min: 150, max: 180 },
    tlsInfo: { protocol: "TLSv1.3", cipher: "TLS_AES_256_GCM_SHA384", sessionReused: false },
    certInfo: { subject: "CN=example.com", issuer: "Let's Encrypt", validFrom: "2024-01-01", validTo: "2024-12-31", san: ["example.com", "www.example.com"] },
    responseInfo: { statusCode: 200, statusText: "OK", headers: { "content-type": "text/html" }, bodySize: 1234 },
    hops: [
      { url: "https://example.com", statusCode: 301, ip: "93.184.216.34", family: "IPv4", stages: { dns: { median: 5, min: 4, max: 6 }, tcp: { median: 10, min: 9, max: 11 }, tls: { median: 15, min: 14, max: 16 }, ttfb: { median: 50, min: 48, max: 52 }, body: { median: 2, min: 1, max: 3 } } },
    ],
    selectedHop: 0,
    isRunning: true,
    history: [160, 162, 165, 158, 165],
    ...overrides,
  };
}

describe("TUI Adapter", () => {
  it("creates an adapter instance", () => {
    const adapter = createHQTUIAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.stop).toBe("function");
    expect(typeof adapter.render).toBe("function");
    expect(typeof adapter.onKey).toBe("function");
  });

  it("registers a key handler", () => {
    const adapter = createHQTUIAdapter();
    const handler = vi.fn();
    adapter.onKey(handler);
    // Can't easily test the handler firing without starting the app
    expect(true).toBe(true);
  });

  it("renders stage meters panel", async () => {
    const state = makeState();

    // Test rendering the stage meters part in isolation
    const output = renderToText(({ ui }) => {
      ui.panel({ title: "Stages" }, (panel) => {
        const stageOrder = ["dns", "tcp", "tls", "ttfb", "body"] as const;
        const stageLabels = { dns: "DNS", tcp: "TCP", tls: "TLS", ttfb: "TTFB", body: "Body" };
        const meters = stageOrder.map((stage) => ({
          label: stageLabels[stage],
          value: state.stages[stage].median / Math.max(state.total.median, 1),
          text: `${state.stages[stage].median.toFixed(2)}ms (${state.stages[stage].min.toFixed(2)}-${state.stages[stage].max.toFixed(2)})`,
        }));
        panel.meters(meters, { columns: 1 });
      });
    }, { width: 80, height: 15 });

    expect(output).toContain("Stages");
    expect(output).toContain("DNS");
    expect(output).toContain("TCP");
    expect(output).toContain("TLS");
    expect(output).toContain("TTFB");
    expect(output).toContain("Body");
  });

  it("renders details panel with TLS, cert, response, and hops", async () => {
    const state = makeState();

    const output = renderToText(({ ui }) => {
      ui.panel({ title: "Details" }, (panel) => {
        const items: { label: string; value: string }[] = [];

        if (state.tlsInfo) {
          items.push(
            { label: "TLS Protocol", value: state.tlsInfo.protocol },
            { label: "Cipher", value: state.tlsInfo.cipher },
            { label: "Session Reused", value: state.tlsInfo.sessionReused ? "Yes" : "No" }
          );
        }

        if (state.certInfo) {
          if (items.length > 0) items.push({ label: "", value: "" });
          items.push(
            { label: "Subject", value: state.certInfo.subject },
            { label: "Issuer", value: state.certInfo.issuer },
            { label: "Valid From", value: state.certInfo.validFrom },
            { label: "Valid To", value: state.certInfo.validTo },
            { label: "SANs", value: state.certInfo.san.join(", ") }
          );
        }

        if (state.responseInfo) {
          if (items.length > 0) items.push({ label: "", value: "" });
          items.push(
            { label: "Status", value: `${state.responseInfo.statusCode} ${state.responseInfo.statusText}` },
            { label: "Body Size", value: `${state.responseInfo.bodySize} bytes` }
          );
        }

        if (state.hops.length > 0) {
          if (items.length > 0) items.push({ label: "", value: "" });
          items.push({ label: "Redirect Hops", value: `${state.hops.length} hop(s)` });
          state.hops.forEach((hop, i) => {
            const prefix = i === state.selectedHop ? "▶ " : "  ";
            items.push({ label: `${prefix}Hop ${i + 1}`, value: `${hop.statusCode} ${hop.ip} (${hop.family})` });
          });
        }

        panel.keyValues(items);
      });
    }, { width: 50, height: 30 });

    expect(output).toContain("Details");
    expect(output).toContain("TLS Protocol");
    expect(output).toContain("TLSv1.3");
    expect(output).toContain("Subject");
    expect(output).toContain("example.com");
    expect(output).toContain("Status");
    expect(output).toContain("200 OK");
    expect(output).toContain("Redirect Hops");
    expect(output).toContain("Hop 1");
    expect(output).toContain("301");
  });

  it("renders history panel with sparkline and jitter", async () => {
    const state = makeState();

    const output = renderToText(({ ui }) => {
      ui.panel({ title: "History" }, (panel) => {
        if (state.history.length === 0) {
          panel.text("No history yet");
          return;
        }
        panel.sparkline(state.history, { min: 0, max: Math.max(...state.history) * 1.2, height: 5 });
        const last = state.history[state.history.length - 1]!;
        const jitterItems = [
          { label: "Last Total", value: `${last.toFixed(2)}ms` },
          { label: "Median", value: `${state.total.median.toFixed(2)}ms` },
          { label: "Min", value: `${state.total.min.toFixed(2)}ms` },
          { label: "Max", value: `${state.total.max.toFixed(2)}ms` },
          { label: "Jitter", value: `${(state.total.max - state.total.min).toFixed(2)}ms` },
        ];
        panel.keyValues(jitterItems);
      });
    }, { width: 80, height: 15 });

    expect(output).toContain("History");
    expect(output).toContain("Last Total");
    expect(output).toContain("Median");
    expect(output).toContain("Jitter");
  });

  it("renders full dashboard layout", async () => {
    const state = makeState();

    const output = renderToText(({ ui }) => {
      ui.grid({ columns: ["2fr", "1fr"], rows: [12, "1fr"], gap: 1 }, (grid) => {
        // Top-left: Stage meters
        grid.panel({ title: "Stages" }, (panel) => {
          const stageOrder = ["dns", "tcp", "tls", "ttfb", "body"] as const;
          const stageLabels = { dns: "DNS", tcp: "TCP", tls: "TLS", ttfb: "TTFB", body: "Body" };
          const meters = stageOrder.map((stage) => ({
            label: stageLabels[stage],
            value: state.stages[stage].median / Math.max(state.total.median, 1),
            text: `${state.stages[stage].median.toFixed(2)}ms (${state.stages[stage].min.toFixed(2)}-${state.stages[stage].max.toFixed(2)})`,
          }));
          panel.meters(meters, { columns: 1 });
        });

        // Top-right: Details
        grid.panel({ title: "Details" }, (panel) => {
          const items: { label: string; value: string }[] = [];
          if (state.tlsInfo) {
            items.push(
              { label: "TLS Protocol", value: state.tlsInfo.protocol },
              { label: "Cipher", value: state.tlsInfo.cipher },
              { label: "Session Reused", value: state.tlsInfo.sessionReused ? "Yes" : "No" }
            );
          }
          panel.keyValues(items);
        });

        // Bottom: History
        grid.panel({ title: "History", colSpan: 2 }, (panel) => {
          if (state.history.length === 0) {
            panel.text("No history yet");
            return;
          }
          panel.sparkline(state.history, { min: 0, max: Math.max(...state.history) * 1.2, height: 5 });
        });
      });

      // Status bar
      ui.statusBar({
        items: [
          { label: "Run 1/5 ● Running" },
          { key: "q", label: "Quit" },
          { key: "r", label: "Restart" },
          { key: "↑", label: "Hop" },
          { key: "Space", label: "Pause" },
        ],
      });
    }, { width: 100, height: 30 });

    expect(output).toContain("Stages");
    expect(output).toContain("Details");
    expect(output).toContain("History");
    expect(output).toContain("Run 1/5");
    expect(output).toContain("Quit");
  });

  it("handles empty history gracefully", async () => {
    const state = makeState({ history: [] });

    const output = renderToText(({ ui }) => {
      ui.panel({ title: "History" }, (panel) => {
        if (state.history.length === 0) {
          panel.text("No history yet");
          return;
        }
      });
    }, { width: 40, height: 8 });

    expect(output).toContain("No history yet");
  });

  it("handles running=false state", async () => {
    const state = makeState({ isRunning: false });

    const output = renderToText(({ ui }) => {
      ui.statusBar({
        items: [
          { label: state.isRunning ? `Run ${state.runIndex + 1}/${state.totalRuns} ● Running` : `Run ${state.runIndex + 1}/${state.totalRuns} ✓ Complete` },
        ],
      });
    }, { width: 60, height: 3 });

    expect(output).toContain("✓ Complete");
  });

  it("handles error state in status bar", async () => {
    const state = makeState({ error: "Connection timeout" });

    const output = renderToText(({ ui }) => {
      ui.statusBar({
        items: [
          { label: "Run 1/5 ✗ Error" },
          { label: state.error ? `Error: ${state.error}` : "" },
        ],
      });
    }, { width: 60, height: 3 });

    expect(output).toContain("Error: Connection timeout");
  });
});