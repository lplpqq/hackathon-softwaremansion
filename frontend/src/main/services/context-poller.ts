import { FullContext, DetectionMode } from "../types";
import { detectFrontmostApp } from "./app-detector";
import { detectBrowserTab, isSupportedBrowser } from "./browser-tab-detector";
import { classifyDomain } from "./domain-classifier";
import { checkArticle, ArticleAnalysis } from "./backend-client";

export interface ContextPollerOptions {
  onContextChange: (ctx: FullContext) => void;
  onArticleAnalysis?: (analysis: ArticleAnalysis) => void;
  onAnalysisStart?: () => void;
  onAnalysisError?: (message: string) => void;
  onHighlightScript?: (script: string, bundleId: string) => void;
  pollIntervalMs?: number;
}

export class ContextPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastFingerprint: string = "";
  private onContextChange: (ctx: FullContext) => void;
  private onArticleAnalysis?: (analysis: ArticleAnalysis) => void;
  private onAnalysisStart?: () => void;
  private onAnalysisError?: (message: string) => void;
  private onHighlightScript?: (script: string, bundleId: string) => void;
  private pollIntervalMs: number;
  private polling = false;
  private lastCheckedUrl: string = "";

  constructor(options: ContextPollerOptions) {
    this.onContextChange = options.onContextChange;
    this.onArticleAnalysis = options.onArticleAnalysis;
    this.onAnalysisStart = options.onAnalysisStart;
    this.onAnalysisError = options.onAnalysisError;
    this.onHighlightScript = options.onHighlightScript;
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

        // Call check-article API for news domains
        if (
          mode === "news" &&
          tab &&
          tab.url !== this.lastCheckedUrl &&
          this.onArticleAnalysis
        ) {
          this.lastCheckedUrl = tab.url;
          if (this.onAnalysisStart) this.onAnalysisStart();
          // Call real check-article API
          if (this.onAnalysisStart) this.onAnalysisStart();
          checkArticle(tab.url).then((analysis) => {
            if (analysis && this.onArticleAnalysis) {
              this.onArticleAnalysis(analysis);

              // Inject highlighting script into the browser tab
              const chunksJson = JSON.stringify(
                analysis.potential_manipulation_text_chunks,
              );
              const script = `
                (function() {
                  let t = document.getElementById('custom-manipulation-tooltip');
                  if (!t) {
                    t = document.createElement('div');
                    t.id = 'custom-manipulation-tooltip';
                    Object.assign(t.style, { position: 'fixed', padding: '8px 12px', background: '#222', color: '#fff', borderRadius: '4px', fontSize: '12px', zIndex: '100000', display: 'none', pointerEvents: 'none', maxWidth: '250px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', fontFamily: 'sans-serif', border: '1px solid rgba(255,255,255,0.1)' });
                    document.body.appendChild(t);
                  }
                  const d = ${chunksJson};
                  d.forEach(item => {
                    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                    let n; let r = [];
                    while(n = walk.nextNode()) { if (n.textContent.includes(item.quote)) r.push(n); }
                    r.forEach(textNode => {
                      const p = textNode.parentNode;
                      if (!p || /SCRIPT|STYLE|TEXTAREA|INPUT/.test(p.nodeName)) return;
                      const parts = textNode.textContent.split(item.quote);
                      const f = document.createDocumentFragment();
                      f.appendChild(document.createTextNode(parts[0]));
                      
                      const h = document.createElement('span');
                      Object.assign(h.style, { backgroundColor: 'rgba(255, 193, 7, 0.2)', borderBottom: '2px solid #ffc107', borderRadius: '2px' });
                      h.textContent = item.quote;
                      f.appendChild(h);

                      const info = document.createElement('span');
                      info.textContent = ' ⓘ';
                      Object.assign(info.style, { cursor: 'help', color: '#856404', fontWeight: 'bold', fontSize: '14px', marginLeft: '4px' });
                      
                      info.onmouseenter = (e) => { t.textContent = item.explanation; t.style.display = 'block'; t.style.left = (e.clientX + 10) + 'px'; t.style.top = (e.clientY + 10) + 'px'; };
                      info.onmousemove = (e) => { t.style.left = (e.clientX + 10) + 'px'; t.style.top = (e.clientY + 10) + 'px'; };
                      info.onmouseleave = () => { t.style.display = 'none'; };
                      
                      f.appendChild(info);
                      f.appendChild(document.createTextNode(parts.slice(1).join(item.quote)));
                      p.replaceChild(f, textNode);
                    });
                  });
                })();
              `.replace(/\n\s*/g, " ");
              
              if (this.onHighlightScript) {
                console.log("[Highlighter] Sending script to active browser tab...");
                this.onHighlightScript(script, app.bundleId);
              }
            } else if (this.onAnalysisError) {
              this.onAnalysisError(
                "Failed to analyze article. The analysis endpoint is currently unavailable (502).",
              );
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
