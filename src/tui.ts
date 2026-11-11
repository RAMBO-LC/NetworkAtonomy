/**
 * TUI (Terminal User Interface) for Network Atonomy using blessed.
 * Provides a btop-style, colorful, real-time dashboard for network timing.
 */

import blessed from "blessed";
import { performance } from "node:perf_hooks";
import type { AggregatedResults, ProbeOptions, StageStats, HopResult, RunAttemptResult } from "./runner";
import { runProbes, calculateStageStats, executeSingleRun } from "./runner";
import { validateUrl, type ValidUrl } from "./url/validate";
import { resolveHostname, type ResolvedHost } from "./net/resolve";

// Color scheme inspired by btop/catppuccin
// Using color names that blessed understands (for tags and style properties)
const COLORS = {
  // Base - use color names that blessed recognizes
  bg: "black",
  fg: "white",
  border: "blue",
  
  // Accents - using color names
  blue: "blue",
  green: "green",
  yellow: "yellow",
  red: "red",
  magenta: "magenta",
  cyan: "cyan",
  orange: "magenta",  // blessed doesn't have orange, use magenta
  pink: "magenta",
  teal: "cyan",
  
  // Semantic
  dns: "blue",
  tcp: "green",
  tls: "magenta",  // orange -> magenta
  ttfb: "yellow",
  body: "magenta",  // pink -> magenta
  total: "cyan",
  
  // Status
  success: "green",
  warning: "yellow",
  error: "red",
  info: "blue",
};

interface TUIOptions {
  url: string;
  runs: number;
  concurrency: number;
  delayMs: number;
  maxBody: number;
  rejectUnauthorized: boolean;
  timeouts?: ProbeOptions["timeouts"];
  allowPrivate?: boolean;
  maxRedirects?: number;
}

interface RunProgress {
  current: number;
  total: number;
  stage: string;
  stageProgress: number;
  runStartTime: number;
  runTimings: Map<string, number>;
  hopCount: number;
}

export class NetworkAtonomyTUI {
  private screen: blessed.Widgets.Screen;
  private layout: {
    header: blessed.Widgets.BoxElement;
    sidebar: blessed.Widgets.BoxElement;
    main: blessed.Widgets.BoxElement;
    footer: blessed.Widgets.BoxElement;
  };
  private widgets: {
    title: blessed.Widgets.TextElement;
    targetInfo: blessed.Widgets.TextElement;
    progressBar: blessed.Widgets.ProgressBarElement;
    progressText: blessed.Widgets.TextElement;
    stageBars: Map<string, blessed.Widgets.ProgressBarElement>;
    stageLabels: Map<string, blessed.Widgets.TextElement>;
    statsTable: blessed.Widgets.TableElement;
    hopList: blessed.Widgets.ListElement;
    logBox: blessed.Widgets.BoxElement;
    footerText: blessed.Widgets.TextElement;
    statusIndicator: blessed.Widgets.TextElement;
  };
  private options: TUIOptions;
  private results: AggregatedResults | null = null;
  private progress: RunProgress;
  private animationFrame: NodeJS.Timeout | null = null;
  private spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private spinnerIndex = 0;
  private logLines: string[] = [];

  constructor(options: TUIOptions) {
    this.options = options;
    this.progress = {
      current: 0,
      total: options.runs,
      stage: "dns",
      stageProgress: 0,
      runStartTime: 0,
      runTimings: new Map(),
      hopCount: 0,
    };

    // Initialize screen
    try {
      this.screen = blessed.screen({
        smartCSR: true,
        title: "Network Atonomy",
        fullUnicode: true,
        dockBorders: true,
        autoPadding: true,
      });
      console.error("Screen initialized successfully");
    } catch (e) {
      console.error("Failed to initialize screen:", e);
      throw e;
    }

    // Setup key handlers
    this.screen.key(["escape", "q", "C-c"], () => this.quit(0));
    this.screen.key(["r"], () => this.restart());
    this.screen.key(["s"], () => this.saveJson());

    // Build layout
    this.layout = this.createLayout();
    this.widgets = this.createWidgets();

    // Initial render
    this.screen.render();
  }

  private createLayout() {
    const header = blessed.box({
      top: 0,
      left: 0,
      width: "100%",
      height: 3,
      border: { type: "line", fg: COLORS.border } as any,
      style: { bg: COLORS.bg },
    });

    const sidebar = blessed.box({
      top: 3,
      left: 0,
      width: "35%",
      height: "100%-7",
      border: { type: "line", fg: COLORS.border } as any,
      style: { bg: COLORS.bg },
    });

    const main = blessed.box({
      top: 3,
      left: "35%",
      width: "65%",
      height: "100%-7",
      border: { type: "line", fg: COLORS.border } as any,
      style: { bg: COLORS.bg },
    });

    const footer = blessed.box({
      bottom: 0,
      left: 0,
      width: "100%",
      height: 4,
      border: { type: "line", fg: COLORS.border } as any,
      style: { bg: COLORS.bg },
    });

    return { header, sidebar, main, footer };
  }

  private createWidgets() {
    // Header widgets
    const title = blessed.text({
      parent: this.layout.header,
      top: 0,
      left: 2,
      content: "{bold}{blue-fg}Network Atonomy{/} {gray-fg}v0.1.0{/}",
      style: { fg: COLORS.fg },
    });

    const targetInfo = blessed.text({
      parent: this.layout.header,
      top: 1,
      left: 2,
      content: `Target: ${this.options.url}`,
      style: { fg: COLORS.cyan },
    });

    // Sidebar widgets
    const progressBar = blessed.progressbar({
      parent: this.layout.sidebar,
      top: 1,
      left: 2,
      width: "90%",
      height: 1,
      border: { type: "line", fg: COLORS.border } as any,
      style: { bar: { bg: COLORS.blue }, bg: COLORS.border } as any,
      pch: "█",
    });

    const progressText = blessed.text({
      parent: this.layout.sidebar,
      top: 3,
      left: 2,
      content: "Run 0 / 5  {gray-fg}(pending){/}",
      style: { fg: COLORS.fg },
    });

    // Stage bars in sidebar
    const stages = ["dns", "tcp", "tls", "ttfb", "body"];
    const stageBars = new Map<string, blessed.Widgets.ProgressBarElement>();
    const stageLabels = new Map<string, blessed.Widgets.TextElement>();

    stages.forEach((stage, i) => {
      const color = COLORS[stage as keyof typeof COLORS] || COLORS.fg;
      const label = blessed.text({
        parent: this.layout.sidebar,
        top: 5 + i * 3,
        left: 2,
        content: `{${color}-fg}${stage.toUpperCase()}{/}`,
        style: { fg: color } as any,
      });

      const bar = blessed.progressbar({
        parent: this.layout.sidebar,
        top: 5 + i * 3,
        left: 12,
        width: "70%",
        height: 1,
        border: { type: "line", fg: COLORS.border } as any,
        style: { bar: { bg: color }, bg: COLORS.border } as any,
        pch: "█",
      });

      stageLabels.set(stage, label);
      stageBars.set(stage, bar);
    });

    // Main area - Stats table
    const statsTable = blessed.table({
      parent: this.layout.main,
      top: 1,
      left: 1,
      width: "100%-2",
      height: "50%-2",
      border: { type: "line", fg: COLORS.border } as any,
      style: {
        header: { fg: COLORS.blue, bold: true } as any,
        cell: { fg: COLORS.fg } as any,
        border: { fg: COLORS.border } as any,
      } as any,
      columnSpacing: 2,
      columnWidth: [22, 14, 14, 14],
      data: [
        ["Stage", "Median", "Min", "Max"],
        ["DNS Lookup", "-", "-", "-"],
        ["TCP Connect", "-", "-", "-"],
        ["TLS Handshake", "-", "-", "-"],
        ["TTFB", "-", "-", "-"],
        ["Body Download", "-", "-", "-"],
        ["Total", "-", "-", "-"],
      ],
    });

    // Hop list
    const hopList = blessed.list({
      parent: this.layout.main,
      top: "50%",
      left: 1,
      width: "100%-2",
      height: "50%-2",
      border: { type: "line", fg: COLORS.border } as any,
      label: " {bold}Redirect Chain{/} ",
      style: {
        fg: COLORS.fg,
        border: { fg: COLORS.border } as any,
        selected: { bg: COLORS.blue, fg: COLORS.bg } as any,
        item: { hover: { bg: COLORS.border } } as any,
      } as any,
      keys: true,
      vi: true,
      items: ["No redirects"],
    });

    // Footer - log box (using Box with manual content)
    const logBox = blessed.box({
      parent: this.layout.footer,
      top: 0,
      left: 1,
      width: "70%",
      height: "100%",
      border: { type: "line", fg: COLORS.border } as any,
      label: " {bold}Live Log{/} ",
      style: { fg: COLORS.fg, border: { fg: COLORS.border } } as any,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: " ", track: { bg: COLORS.border }, style: { bg: COLORS.blue } } as any,
      content: "",
      tags: true,
    });

    // Make log box focusable for scrolling
    logBox.key(["up"], () => logBox.scroll(-1));
    logBox.key(["down"], () => logBox.scroll(1));
    logBox.key(["pageup"], () => logBox.scroll(-10));
    logBox.key(["pagedown"], () => logBox.scroll(10));

    // Footer right - status
    const statusIndicator = blessed.text({
      parent: this.layout.footer,
      top: 0,
      right: 2,
      content: "{green-fg}●{/} Ready",
      style: { fg: COLORS.success } as any,
    });

    const footerText = blessed.text({
      parent: this.layout.footer,
      top: 2,
      left: 2,
      content: "[q/ESC] Quit  [r] Restart  [s] Save JSON  [↑/↓] Scroll Log",
      style: { fg: COLORS.border } as any,
    });

    return {
      title,
      targetInfo,
      progressBar,
      progressText,
      stageBars,
      stageLabels,
      statsTable,
      hopList,
      logBox,
      footerText,
      statusIndicator,
    };
  }

  private log(message: string, level: "info" | "success" | "warning" | "error" = "info") {
    const colors = { info: COLORS.info, success: COLORS.success, warning: COLORS.warning, error: COLORS.error };
    const icons = { info: "ℹ", success: "✓", warning: "⚠", error: "✗" };
    const timestamp = new Date().toLocaleTimeString();
    const line = `{${colors[level]}-fg}[${timestamp}] ${icons[level]} ${message}{/}`;
    this.logLines.push(line);
    if (this.logLines.length > 50) this.logLines.shift();
    this.widgets.logBox.setContent(this.logLines.join("\n"));
    this.screen.render();
  }

  private updateStatus(message: string, level: "info" | "success" | "warning" | "error" = "info") {
    const colors = { info: COLORS.info, success: COLORS.success, warning: COLORS.warning, error: COLORS.error };
    const icons = { info: "●", success: "✓", warning: "⚠", error: "✗" };
    this.widgets.statusIndicator.setContent(`{${colors[level]}-fg}${icons[level]}{/} ${message}`);
    this.screen.render();
  }

  private startSpinner() {
    if (this.animationFrame) return;
    this.animationFrame = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      this.updateSpinnerDisplay();
      this.screen.render();
    }, 80);
  }

  private stopSpinner() {
    if (this.animationFrame) {
      clearInterval(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private getSpinner() {
    return this.spinnerFrames[this.spinnerIndex];
  }

  private updateSpinnerDisplay() {
    const stage = this.progress.stage;
    const label = this.widgets.stageLabels.get(stage);
    if (label) {
      const color = COLORS[stage as keyof typeof COLORS] || COLORS.fg;
      label.setContent(`{${color}-fg}${stage.toUpperCase()}{/} ${this.getSpinner()}`);
    }
  }

  async run() {
    this.updateStatus("Resolving...", "info");
    this.log(`Starting probe for ${this.options.url}`, "info");

    try {
      // Validate URL
      const validation = validateUrl(this.options.url);
      if (!validation.ok) {
        throw new Error((validation as any).message);
      }

      // Resolve hostname
      this.progress.stage = "dns";
      this.startSpinner();
      this.widgets.stageLabels.get("dns")?.setContent(`{${COLORS.dns}-fg}DNS{/} ${this.getSpinner()}`);
      
      const resolvedHost = await resolveHostname(
        validation.hostname,
        undefined,
        this.options.allowPrivate
      );

      this.widgets.targetInfo.setContent(
        `Target: ${this.options.url} (${resolvedHost.address} - ${resolvedHost.family.toUpperCase()})`
      );
      this.log(`Resolved ${validation.hostname} → ${resolvedHost.address} (${resolvedHost.family})`, "success");

      // Run probes with progress updates
      console.error("Building probeOpts...");
      const probeOpts: ProbeOptions = {
        url: validation,
        runs: this.options.runs,
        concurrency: this.options.concurrency,
        delayMs: this.options.delayMs,
        maxBody: this.options.maxBody,
        rejectUnauthorized: this.options.rejectUnauthorized,
        timeouts: this.options.timeouts,
        allowPrivate: this.options.allowPrivate,
        maxRedirects: this.options.maxRedirects,
      };
      console.error("probeOpts:", probeOpts);

      console.error("Running probes with progress...");
      this.results = await this.runProbesWithProgress(probeOpts, resolvedHost);
      console.error("Probes completed");

      this.stopSpinner();
      this.updateStatus("Complete", "success");
      this.log("All runs completed successfully", "success");
      this.renderFinalResults();

      // Wait for user to quit
      await this.waitForExit();
    } catch (error) {
      this.stopSpinner();
      const message = error instanceof Error ? error.message : String(error);
      this.updateStatus("Failed", "error");
      this.log(`Error: ${message}`, "error");
      await this.waitForExit();
      throw error;
    }
  }

  private async runProbesWithProgress(
    options: ProbeOptions,
    resolvedHost: ResolvedHost
  ): Promise<AggregatedResults> {
    const { runs = 5, delayMs = 0, concurrency = 1 } = options;
    const results: RunAttemptResult[] = [];

    if (concurrency <= 1) {
      // Sequential execution
      for (let i = 0; i < runs; i++) {
        this.progress.current = i;
        this.progress.runStartTime = performance.now();

        await this.runSingleWithProgress(options, resolvedHost, i, results);
        
        if (i < runs - 1 && delayMs > 0) {
          this.log(`Waiting ${delayMs}ms before next run...`, "info");
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    } else {
      // Concurrent execution
      const queue = Array.from({ length: runs }, (_, i) => i);
      const running = new Set<Promise<void>>();

      const runNext = async (index: number): Promise<void> => {
        this.progress.current = index;
        this.progress.runStartTime = performance.now();
        await this.runSingleWithProgress(options, resolvedHost, index, results);
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      };

      for (const index of queue) {
        const promise = runNext(index).then(() => {
          running.delete(promise);
        });
        running.add(promise);

        if (running.size >= concurrency) {
          await Promise.race(running);
        }
      }

      await Promise.all(running);
    }

    // Aggregate results
    return this.aggregateResults(results, options.runs ?? 5, resolvedHost);
  }

  private async runSingleWithProgress(
    options: ProbeOptions,
    resolvedHost: ResolvedHost,
    runIndex: number,
    results: RunAttemptResult[]
  ) {
    const stages = ["dns", "tcp", "tls", "ttfb", "body"];
    
    this.widgets.progressText.setContent(`Run ${runIndex + 1} / ${this.options.runs}  {${COLORS.blue}-fg}${this.getSpinner()} Running{/}`);
    this.widgets.progressBar.setProgress(Math.floor(((runIndex) / this.options.runs) * 100));
    this.screen.render();

    try {
      const timing = await executeSingleRun(options, resolvedHost);
      
      // Animate stage completion
      for (const stage of stages) {
        this.widgets.stageBars.get(stage)?.setProgress(100);
        const color = COLORS[stage as keyof typeof COLORS] || COLORS.fg;
        this.widgets.stageLabels.get(stage)?.setContent(`{${color}-fg}${stage.toUpperCase()}{/} {green-fg}✓{/}`);
        this.screen.render();
        await new Promise((r) => setTimeout(r, 50));
      }

      results.push({ success: true, timing: timing.timing });
      this.log(`Run ${runIndex + 1} completed in ${timing.timing!.totalMs.toFixed(2)}ms`, "success");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      results.push({ success: false, error: err });
      this.log(`Run ${runIndex + 1} failed: ${err.message}`, "error");
    }
  }

  private aggregateResults(
    runResults: RunAttemptResult[],
    runs: number,
    resolvedHost: ResolvedHost
  ): AggregatedResults {
    const successfulRuns = runResults.filter((r): r is RunAttemptResult & { timing: any } => r.success);
    const failedRuns = runResults.filter((r) => !r.success);

    if (successfulRuns.length === 0) {
      const firstError = failedRuns[0]?.error;
      throw firstError ?? new Error("All runs failed with unknown error");
    }

    const dnsValues = successfulRuns.map((r) => r.timing.dnsMs);
    const tcpValues = successfulRuns.map((r) => r.timing.tcpMs);
    const tlsValues = successfulRuns.map((r) => r.timing.tlsMs);
    const ttfbValues = successfulRuns.map((r) => r.timing.ttfbMs);
    const bodyValues = successfulRuns.map((r) => r.timing.bodyMs);
    const totalValues = successfulRuns.map((r) => r.timing.totalMs);

    const dnsStats = calculateStageStats(dnsValues);
    const tcpStats = calculateStageStats(tcpValues);
    const tlsStats = calculateStageStats(tlsValues);
    const ttfbStats = calculateStageStats(ttfbValues);
    const bodyStats = calculateStageStats(bodyValues);
    const totalStats = calculateStageStats(totalValues);

    const firstRunHops = successfulRuns[0]?.timing.hops ?? [];
    const aggregatedHops: HopResult[] = firstRunHops.map((hop: any) => ({
      url: hop.url,
      statusCode: hop.statusCode,
      stages: {
        dns: { medianMs: hop.dnsMs, minMs: hop.dnsMs, maxMs: hop.dnsMs },
        tcp: { medianMs: hop.tcpMs, minMs: hop.tcpMs, maxMs: hop.tcpMs },
        tls: { medianMs: hop.tlsMs, minMs: hop.tlsMs, maxMs: hop.tlsMs },
        ttfb: { medianMs: hop.ttfbMs, minMs: hop.ttfbMs, maxMs: hop.ttfbMs },
        body: { medianMs: hop.bodyMs, minMs: hop.bodyMs, maxMs: hop.bodyMs },
      },
    }));

    const warnings: string[] = [];
    if (failedRuns.length > 0) {
      warnings.push(`Warning: ${failedRuns.length} of ${runs} runs failed.`);
    }

    return {
      stages: { dns: dnsStats, tcp: tcpStats, tls: tlsStats, ttfb: ttfbStats, body: bodyStats },
      total: totalStats,
      runsRequested: runs,
      runsSuccessful: successfulRuns.length,
      runsFailed: failedRuns.length,
      url: this.options.url,
      ip: resolvedHost.address,
      family: resolvedHost.family === "ipv4" ? "IPv4" : "IPv6",
      statusCode: successfulRuns[0]!.timing.statusCode,
      warnings,
      hops: aggregatedHops,
    };
  }

  private renderFinalResults() {
    if (!this.results) return;

    const { stages, total, runsSuccessful, runsFailed, warnings, hops, statusCode, ip, family } = this.results;

    // Update stats table
    const format = (ms: number) => ms.toFixed(2);
    this.widgets.statsTable.setData([
      ["Stage", "Median", "Min", "Max"],
      ["DNS Lookup", format(stages.dns.medianMs), format(stages.dns.minMs), format(stages.dns.maxMs)],
      ["TCP Connect", format(stages.tcp.medianMs), format(stages.tcp.minMs), format(stages.tcp.maxMs)],
      ["TLS Handshake", format(stages.tls.medianMs), format(stages.tls.minMs), format(stages.tls.maxMs)],
      ["TTFB", format(stages.ttfb.medianMs), format(stages.ttfb.minMs), format(stages.ttfb.maxMs)],
      ["Body Download", format(stages.body.medianMs), format(stages.body.minMs), format(stages.body.maxMs)],
      ["Total", format(total.medianMs), format(total.minMs), format(total.maxMs)],
    ]);

    // Update progress to 100%
    this.widgets.progressBar.setProgress(100);
    this.widgets.progressText.setContent(`Run ${runsSuccessful} / ${runsSuccessful + runsFailed}  {${COLORS.green}-fg}Complete{/}`);

    // Update hop list
    if (hops.length > 0) {
      const hopItems = hops.map((hop, i) => {
        const redirect = hop.statusCode >= 300 && hop.statusCode < 400 ? " → " : "";
        const hopTotal = hop.stages.dns.medianMs + hop.stages.tcp.medianMs + hop.stages.tls.medianMs + hop.stages.ttfb.medianMs + hop.stages.body.medianMs;
        return `${i + 1}. ${hop.url} {gray-fg}[${hop.statusCode}]${redirect}{/} ${format(hopTotal)}ms`;
      });
      this.widgets.hopList.setItems(hopItems);
    } else {
      this.widgets.hopList.setItems(["No redirects"]);
    }

    // Final summary log
    this.log(`Status: ${statusCode} | IP: ${ip} (${family}) | Success: ${runsSuccessful}/${runsSuccessful + runsFailed}`, "info");
    for (const w of warnings) {
      this.log(w, "warning");
    }

    this.screen.render();
  }

  private async waitForExit(): Promise<void> {
    return new Promise((resolve) => {
      const handler = (): void => {
        this.screen.removeListener("keypress", handler);
        resolve();
      };
      this.screen.on("keypress", handler);
    });
  }

  private restart() {
    this.log("Restarting...", "info");
    this.screen.destroy();
    process.exit(0);
  }

  private saveJson() {
    if (!this.results) {
      this.log("No results to save yet", "warning");
      return;
    }
    const fs = require("fs");
    const filename = `networkatonomy-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(this.results, null, 2));
    this.log(`Results saved to ${filename}`, "success");
  }

  private quit(code: number) {
    this.stopSpinner();
    this.screen.destroy();
    process.exit(code);
  }
}

// Export a simple function to launch the TUI
export async function runTUI(options: TUIOptions): Promise<void> {
  console.error("runTUI called with:", options);
  const tui = new NetworkAtonomyTUI(options);
  console.error("TUI created, calling run...");
  await tui.run();
  console.error("TUI run completed");
}