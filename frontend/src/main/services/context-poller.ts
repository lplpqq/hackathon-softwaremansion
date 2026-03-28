import { FullContext, DetectionMode } from "../types";
import { detectFrontmostApp } from "./app-detector";
import {
  detectBrowserTab,
  isSupportedBrowser,
} from "./browser-tab-detector";
import { classifyDomain } from "./domain-classifier";
import { notifyBackend } from "./backend-client";

export interface ContextPollerOptions {
  onContextChange: (ctx: FullContext) => void;
  pollIntervalMs?: number;
}

export class ContextPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastFingerprint: string = "";
  private onContextChange: (ctx: FullContext) => void;
  private pollIntervalMs: number;
  private polling = false;

  constructor(options: ContextPollerOptions) {
    this.onContextChange = options.onContextChange;
    this.pollIntervalMs = options.pollIntervalMs ?? 750;
  }

  start(): void {
    if (this.intervalId) return;
    this.poll();
    this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  get isRunning(): boolean {
    return this.intervalId !== null;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const app = await detectFrontmostApp();

      const tab = isSupportedBrowser(app.bundleId)
        ? await detectBrowserTab(app.bundleId)
        : null;

      const classification = tab ? classifyDomain(tab.url) : null;

      let mode: DetectionMode = "idle";
      if (classification?.isNewsDomain) mode = "news";
      else if (classification?.isVideoDomain) mode = "video";

      const context: FullContext = { app, tab, classification, mode };
      const fingerprint = `${app.bundleId}|${tab?.url ?? ""}`;

      if (fingerprint !== this.lastFingerprint) {
        this.lastFingerprint = fingerprint;
        this.onContextChange(context);

        if (classification?.isSupportedDomain) {
          notifyBackend(context);
        }
      }
    } catch (err) {
      console.error("[context-poller] Poll error:", err);
    } finally {
      this.polling = false;
    }
  }
}
