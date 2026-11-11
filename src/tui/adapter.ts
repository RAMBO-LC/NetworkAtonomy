/**
 * TUI Adapter for @profullstack/hqtui
 *
 * This is the ONLY file that imports @profullstack/hqtui.
 * All panels and key handling call the adapter's own functions.
 * If the library is replaced, only this file changes.
 */

import type { App, Container, Theme, KeyEvent as HqKeyEvent } from "@profullstack/hqtui";
import type { StageStats } from "../runner";

/** State passed to render a frame */
export interface TUIState {
  /** Current run index (0-based) */
  runIndex: number;
  /** Total runs configured */
  totalRuns: number;
  /** Stage timings for the current/last run */
  stages: {
    dns: StageTiming;
    tcp: StageTiming;
    tls: StageTiming;
    ttfb: StageTiming;
    body: StageTiming;
  };
  /** Total timing */
  total: StageTiming;
  /** TLS information */
  tlsInfo?: TLSInfo;
  /** Certificate information */
  certInfo?: CertInfo;
  /** Response information */
  responseInfo?: ResponseInfo;
  /** Redirect hops */
  hops: HopInfo[];
  /** Currently selected hop index */
  selectedHop: number;
  /** Whether the probe is running */
  isRunning: boolean;
  /** Error message if any */
  error?: string;
  /** History of total timings for sparkline */
  history: number[];
}

/** Individual stage timing */
export interface StageTiming {
  median: number;
  min: number;
  max: number;
}

/** TLS information */
export interface TLSInfo {
  protocol: string;
  cipher: string;
  sessionReused: boolean;
}

/** Certificate information */
export interface CertInfo {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  san: string[];
}

/** Response information */
export interface ResponseInfo {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  bodySize: number;
}

/** Redirect hop information */
export interface HopInfo {
  url: string;
  statusCode: number;
  ip: string;
  family: "IPv4" | "IPv6";
  stages: {
    dns: StageStats;
    tcp: StageStats;
    tls: StageStats;
    ttfb: StageStats;
    body: StageStats;
  };
}

/** Key event from the adapter */
export interface KeyEvent {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** Adapter interface */
export interface TUIAdapter {
  /** Start the TUI application */
  start(state: TUIState): Promise<void>;
  /** Stop the TUI application */
  stop(): Promise<void>;
  /** Update state and render a frame */
  render(state: TUIState): void;
  /** Register a key handler */
  onKey(handler: (key: KeyEvent) => void): void;
}

/** Create the HQTUI adapter */
export function createHQTUIAdapter(): TUIAdapter {
  let app: App | null = null;
  let keyHandler: ((key: KeyEvent) => void) | null = null;
  let currentState: TUIState | null = null;

  async function start(initialState: TUIState): Promise<void> {
    currentState = initialState;
    const { createApp } = await import("@profullstack/hqtui");
    app = await createApp({
      fps: 30,
      theme: "dark",
    });

    // Set up key handling
    app.on("key", (key: HqKeyEvent) => {
      if (keyHandler) {
        keyHandler({
          key: key.name,
          ctrl: key.ctrl,
          shift: key.shift,
          alt: key.alt,
        });
      }
    });

    // Initial render
    render(initialState);

    // Start the app
    await app.start();
  }

  async function stop(): Promise<void> {
    if (app) {
      await app.stop();
      app = null;
    }
  }

  function render(state: TUIState): void {
    if (!app) return;
    currentState = state;

    app.render(({ ui, theme }) => {
      renderDashboard(ui, theme, state);
    });
  }

  function onKey(handler: (key: KeyEvent) => void): void {
    keyHandler = handler;
  }

  return { start, stop, render, onKey };
}

/** Render the full dashboard */
function renderDashboard(ui: Container, theme: Theme, state: TUIState): void {
  const { runIndex, totalRuns, stages, total, tlsInfo, certInfo, responseInfo, hops, selectedHop, isRunning, error, history } = state;

  // Layout: 2 columns (2fr, 1fr), 2 rows (12, 1fr)
  ui.grid({ columns: ["2fr", "1fr"], rows: [12, "1fr"], gap: 1 }, (grid) => {
    // Top-left: Stage meters (2fr width)
    grid.panel({ title: "Stages" }, (panel) => {
      renderStageMeters(panel, stages, total);
    });

    // Top-right: Key/values for TLS, cert, response (1fr width)
    grid.panel({ title: "Details" }, (panel) => {
      renderDetails(panel, tlsInfo, certInfo, responseInfo, hops, selectedHop);
    });

    // Bottom: History sparkline + jitter range (full width, colSpan: 2)
    grid.panel({ title: "History", colSpan: 2 }, (panel) => {
      renderHistory(panel, history, total);
    });
  });

  // Footer status bar
  ui.statusBar({
    items: [
      { label: isRunning ? `Run ${runIndex + 1}/${totalRuns} ● Running` : `Run ${runIndex + 1}/${totalRuns} ✓ Complete` },
      { label: error ? `Error: ${error}` : "" },
      { key: "q", label: "Quit" },
      { key: "r", label: "Restart" },
      { key: "↑", label: "Hop" },
      { key: "Space", label: "Pause" },
    ],
  });
}

/** Render stage meters */
function renderStageMeters(panel: Container, stages: TUIState["stages"], total: StageTiming): void {
  const stageOrder: (keyof TUIState["stages"])[] = ["dns", "tcp", "tls", "ttfb", "body"];
  const stageLabels: Record<keyof TUIState["stages"], string> = {
    dns: "DNS",
    tcp: "TCP",
    tls: "TLS",
    ttfb: "TTFB",
    body: "Body",
  };

  const meters = stageOrder.map((stage) => ({
    label: stageLabels[stage],
    value: stages[stage].median / Math.max(total.median, 1), // Normalized for meter
    text: `${stages[stage].median.toFixed(2)}ms (${stages[stage].min.toFixed(2)}-${stages[stage].max.toFixed(2)})`,
  }));

  panel.meters(meters, { columns: 1 });
}

/** Render TLS, certificate, response, and redirect details */
function renderDetails(panel: Container, tlsInfo: TUIState["tlsInfo"], certInfo: TUIState["certInfo"], responseInfo: TUIState["responseInfo"], hops: HopInfo[], selectedHop: number): void {
  const items: { label: string; value: string }[] = [];

  if (tlsInfo) {
    items.push(
      { label: "TLS Protocol", value: tlsInfo.protocol },
      { label: "Cipher", value: tlsInfo.cipher },
      { label: "Session Reused", value: tlsInfo.sessionReused ? "Yes" : "No" }
    );
  }

  if (certInfo) {
    if (items.length > 0) items.push({ label: "", value: "" }); // separator
    items.push(
      { label: "Subject", value: certInfo.subject },
      { label: "Issuer", value: certInfo.issuer },
      { label: "Valid From", value: certInfo.validFrom },
      { label: "Valid To", value: certInfo.validTo },
      { label: "SANs", value: certInfo.san.join(", ") }
    );
  }

  if (responseInfo) {
    if (items.length > 0) items.push({ label: "", value: "" });
    items.push(
      { label: "Status", value: `${responseInfo.statusCode} ${responseInfo.statusText}` },
      { label: "Body Size", value: `${responseInfo.bodySize} bytes` }
    );
  }

  if (hops.length > 0) {
    if (items.length > 0) items.push({ label: "", value: "" });
    items.push({ label: "Redirect Hops", value: `${hops.length} hop(s)` });
    hops.forEach((hop, i) => {
      const prefix = i === selectedHop ? "▶ " : "  ";
      items.push({ label: `${prefix}Hop ${i + 1}`, value: `${hop.statusCode} ${hop.ip} (${hop.family})` });
    });
  }

  panel.keyValues(items);
}

/** Render history sparkline and jitter range */
function renderHistory(panel: Container, history: number[], total: StageTiming): void {
  if (history.length === 0) {
    panel.text("No history yet");
    return;
  }

  // Sparkline of totals
  panel.sparkline({ values: history, min: 0, max: Math.max(...history) * 1.2 });

  // Jitter range bar (custom - show min/median/max of last run)
  const last = history[history.length - 1]!;
  const jitterItems = [
    { label: "Last Total", value: `${last.toFixed(2)}ms` },
    { label: "Median", value: `${total.median.toFixed(2)}ms` },
    { label: "Min", value: `${total.min.toFixed(2)}ms` },
    { label: "Max", value: `${total.max.toFixed(2)}ms` },
    { label: "Jitter", value: `${(total.max - total.min).toFixed(2)}ms` },
  ];
  panel.keyValues(jitterItems);
}