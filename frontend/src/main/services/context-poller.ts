import { FullContext, DetectionMode } from "../types";
import { detectFrontmostApp } from "./app-detector";
import { detectBrowserTab, isSupportedBrowser } from "./browser-tab-detector";
import { classifyDomain } from "./domain-classifier";
import { notifyBackend, checkArticle, ArticleAnalysis } from "./backend-client";

export interface ContextPollerOptions {
  onContextChange: (ctx: FullContext) => void;
  onArticleAnalysis?: (analysis: ArticleAnalysis) => void;
  onAnalysisStart?: () => void;
  onAnalysisError?: (message: string) => void;
  pollIntervalMs?: number;
}

export class ContextPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastFingerprint: string = "";
  private onContextChange: (ctx: FullContext) => void;
  private onArticleAnalysis?: (analysis: ArticleAnalysis) => void;
  private onAnalysisStart?: () => void;
  private onAnalysisError?: (message: string) => void;
  private pollIntervalMs: number;
  private polling = false;
  private lastCheckedUrl: string = "";

  constructor(options: ContextPollerOptions) {
    this.onContextChange = options.onContextChange;
    this.onArticleAnalysis = options.onArticleAnalysis;
    this.onAnalysisStart = options.onAnalysisStart;
    this.onAnalysisError = options.onAnalysisError;
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

        // Call check-article API for news domains
        if (
          mode === "news" &&
          tab &&
          tab.url !== this.lastCheckedUrl &&
          this.onArticleAnalysis
        ) {
          this.lastCheckedUrl = tab.url;
          if (this.onAnalysisStart) this.onAnalysisStart();
          checkArticle(tab.url).then((analysis) => {
            if (analysis && this.onArticleAnalysis) {
              this.onArticleAnalysis(analysis);
            } else if (this.onAnalysisError) {
              this.onAnalysisError("Failed to analyze article. The analysis endpoint is currently unavailable (502).");
            }
          });
        }

        // Clear analysis when leaving news mode
        if (mode !== "news" && this.lastCheckedUrl) {
          this.lastCheckedUrl = "";
        }
      }
    } catch (err) {
      console.error("[context-poller] Poll error:", err);
    } finally {
      this.polling = false;
    }
  }
}
