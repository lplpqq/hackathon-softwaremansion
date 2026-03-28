import { useEffect, useState } from "react";
import type { FullContext, DetectionMode, ArticleAnalysis } from "./types";

const MODE_LABELS: Record<DetectionMode, string> = {
  idle: "IDLE",
  news: "NEWS",
  video: "VIDEO",
};

const MODE_COLORS: Record<DetectionMode, string> = {
  idle: "#666",
  news: "#4ecdc4",
  video: "#ff6b6b",
};

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

type ViewMode = "context" | "analysis";

function scoreColor(score: number): string {
  if (score >= 0.8) return "#4ecdc4";
  if (score >= 0.5) return "#f0c040";
  return "#ff6b6b";
}

export default function App() {
  const [context, setContext] = useState<FullContext | null>(null);
  const [analysis, setAnalysis] = useState<ArticleAnalysis | null>(null);
  const [view, setView] = useState<ViewMode>("context");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.9);

  useEffect(() => {
    const unsubCtx = window.electronAPI.onContextUpdate((ctx) => {
      setContext(ctx);
      // Clear analysis when leaving news mode
      if (ctx.mode !== "news") {
        setAnalysis(null);
        setError(null);
        setView("context");
      }
    });
    const unsubAnalysis = window.electronAPI.onArticleAnalysis((data) => {
      setAnalysis(data);
      setIsLoading(false);
      setError(null);
      setView("analysis");
    });
    const unsubStart = window.electronAPI.onAnalysisStart(() => {
      setIsLoading(true);
      setError(null);
      setView("analysis");
    });
    const unsubError = window.electronAPI.onAnalysisError((msg) => {
      setError(msg);
      setIsLoading(false);
      setView("analysis");
    });
    return () => {
      unsubCtx();
      unsubAnalysis();
      unsubStart();
      unsubError();
    };
  }, []);

  const handleOpacity = (value: number) => {
    setOpacity(value);
    window.electronAPI.setOpacity(value);
  };

  const mode = context?.mode ?? "idle";
  const modeColor = MODE_COLORS[mode];

  return (
    <div className="overlay-root">
      {/* Drag handle */}
      <div className="drag-bar">
        <span className="app-title">Authently</span>
        <div className="mode-badge" style={{ backgroundColor: modeColor }}>
          {MODE_LABELS[mode]}
        </div>
      </div>

      {/* View toggle (only show when analysis is available) */}
      {(analysis || isLoading || error) && (
        <div className="view-toggle no-drag">
          <button
            className={`toggle-btn ${view === "context" ? "active" : ""}`}
            onClick={() => setView("context")}
          >
            Context
          </button>
          <button
            className={`toggle-btn ${view === "analysis" ? "active" : ""}`}
            onClick={() => setView("analysis")}
          >
            Analysis
          </button>
        </div>
      )}

      {/* Content */}
      <div
        className={`overlay-content ${view === "analysis" ? "scrollable" : ""}`}
      >
        {view === "context" ? (
          /* ── Context view ── */
          context ? (
            <>
              <div className="info-row">
                <span className="label">App</span>
                <span className="value">{context.app.appName}</span>
              </div>

              {context.tab && (
                <>
                  <div className="info-row">
                    <span className="label">Browser</span>
                    <span className="value">{context.tab.browserName}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Domain</span>
                    <span
                      className="value domain"
                      style={{
                        color: context.classification?.isSupportedDomain
                          ? modeColor
                          : "#888",
                      }}
                    >
                      {context.classification?.domain || "—"}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="label">Title</span>
                    <span className="value title">
                      {truncate(context.tab.title, 60)}
                    </span>
                  </div>
                </>
              )}

              {!context.tab && (
                <div className="info-row">
                  <span className="label">Window</span>
                  <span className="value">
                    {truncate(context.app.windowTitle || "—", 50)}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="info-row">
              <span className="value waiting">Detecting...</span>
            </div>
          )
        ) : (
          /* ── Analysis view ── */
          <>
            {isLoading && (
              <div className="loading-container">
                <div className="loading-shimmer" />
                <div className="loading-shimmer" />
                <div className="loading-shimmer" />
                <span className="loading-label">Analyzing Article with Gemini...</span>
              </div>
            )}

            {error && !isLoading && (
              <div className="error-container">
                <span className="error-icon">⚠</span>
                <p className="error-message">{error}</p>
              </div>
            )}

            {!isLoading && !error && analysis && (
              <>
                {/* Credibility score */}
                <div className="analysis-summary-row">
                  {/* Publisher */}
                  <div className="analysis-section publisher-section">
                    <span className="label">Publisher</span>
                    <p className="analysis-text">
                      {analysis.publisher_description}
                    </p>
                  </div>

                  {/* Credibility score */}
                  <div className="analysis-section speedometer-section">
                    <span className="label">Credibility</span>
                    <div className="speedometer-container">
                      <svg viewBox="0 0 100 100" className="speedometer-svg">
                        {/* Background Track (225 degrees) */}
                        <path
                          d="M 13.04 65.3 A 40 40 0 1 1 86.96 65.3"
                          fill="none"
                          stroke="rgba(255,255,255,0.05)"
                          strokeWidth="6"
                          strokeLinecap="round"
                        />
                        {/* Gradient Track Progress */}
                        <path
                          d="M 13.04 65.3 A 40 40 0 1 1 86.96 65.3"
                          fill="none"
                          stroke="url(#speed-gradient)"
                          strokeWidth="6"
                          strokeLinecap="round"
                          strokeDasharray="157.08"
                          strokeDashoffset={
                            157.08 * (1 - analysis.source_credibility_score)
                          }
                          className="speed-progress"
                        />
                        <defs>
                          <linearGradient
                            id="speed-gradient"
                            x1="0%"
                            y1="100%"
                            x2="100%"
                            y2="100%"
                          >
                            <stop offset="0%" stopColor="#ff4d4d" />
                            <stop offset="50%" stopColor="#ffd11a" />
                            <stop offset="100%" stopColor="#2ecc71" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="speedometer-text">
                        <span className="speedometer-value">
                          {(analysis.source_credibility_score * 100).toFixed(0)}
                        </span>
                        <span className="speedometer-percent"></span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Short analysis */}
                <div className="analysis-section">
                  <span className="label">Analysis</span>
                  <p className="analysis-text">{analysis.short_text_analysis}</p>
                </div>

                {/* Manipulation chunks */}
                {analysis.potential_manipulation_text_chunks.length > 0 && (
                  <div className="analysis-section">
                    <span className="label manipulation-label">
                      ⚠ Potential Manipulation
                    </span>
                    <div className="manipulation-list">
                      {analysis.potential_manipulation_text_chunks.map(
                        (chunk, i) => (
                          <div key={i} className="manipulation-card">
                            <p className="manipulation-quote">{chunk.quote}</p>
                            <p className="manipulation-explanation">
                              {chunk.explanation}
                            </p>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Opacity slider */}
      <div className="opacity-bar no-drag">
        <span className="opacity-label">Opacity</span>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => handleOpacity(parseFloat(e.target.value))}
          className="opacity-slider"
        />
      </div>
    </div>
  );
}
