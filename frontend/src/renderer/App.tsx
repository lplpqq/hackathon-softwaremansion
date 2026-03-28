import { useEffect, useState } from "react";
import type {
  FullContext,
  DetectionMode,
  ArticleAnalysis,
  LiveAnalysis,
} from "./types";
import { useFishjamAudio } from "./hooks/useFishjamAudio";

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
type LiveVerdict = "FACT" | "OPINION" | "UNSURE" | "NO_CLAIM";

interface ParsedLiveAnalysis {
  verdict: LiveVerdict;
  confidence: number;
  explanation: string;
  claim: string;
  transcript: string;
  alarm: boolean;
}

function scoreColor(score: number): string {
  if (score >= 0.8) return "#4ecdc4";
  if (score >= 0.5) return "#f0c040";
  return "#ff6b6b";
}

function parseLiveAnalysis(text: string): ParsedLiveAnalysis | null {
  try {
    const parsed = JSON.parse(text) as Partial<ParsedLiveAnalysis>;

    if (
      typeof parsed.verdict !== "string" ||
      typeof parsed.confidence !== "number" ||
      typeof parsed.explanation !== "string" ||
      typeof parsed.claim !== "string" ||
      typeof parsed.transcript !== "string" ||
      typeof parsed.alarm !== "boolean"
    ) {
      return null;
    }

    return {
      verdict: parsed.verdict as LiveVerdict,
      confidence: parsed.confidence,
      explanation: parsed.explanation,
      claim: parsed.claim,
      transcript: parsed.transcript,
      alarm: parsed.alarm,
    };
  } catch {
    return null;
  }
}

function verdictColor(verdict: LiveVerdict, alarm: boolean): string {
  if (alarm) return "#ff6b6b";
  if (verdict === "FACT") return "#4ecdc4";
  if (verdict === "OPINION") return "#f0c040";
  return "#b8b8c4";
}

export default function App() {
  const [context, setContext] = useState<FullContext | null>(null);
  const [analysis, setAnalysis] = useState<ArticleAnalysis | null>(null);
  const [view, setView] = useState<ViewMode>("context");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.9);
  const [liveMessages, setLiveMessages] = useState<LiveAnalysis[]>([]);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioCaptureRequested, setAudioCaptureRequested] = useState(false);
  const [audioStartToken, setAudioStartToken] = useState(0);

  const mode = context?.mode ?? "idle";

  useFishjamAudio({
    active: mode === "video" && audioCaptureRequested,
    startToken: audioStartToken,
    onAnalysis: (msg) => setLiveMessages((prev) => [msg, ...prev].slice(0, 50)),
    onError: (err) => setAudioError(err),
  });

  useEffect(() => {
    const unsubCtx = window.electronAPI.onContextUpdate((ctx) => {
      setContext(ctx);
      // Clear analysis when leaving news mode
      if (ctx.mode !== "news") {
        setAnalysis(null);
        setError(null);
        setView("context");
      }
      // Clear live audio state when leaving video mode
      if (ctx.mode !== "video") {
        setLiveMessages([]);
        setAudioError(null);
        setAudioCaptureRequested(false);
        setAudioStartToken(0);
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

  const handleStartSystemAudio = () => {
    setAudioError(null);
    setLiveMessages([]);
    setAudioCaptureRequested(true);
    setAudioStartToken((prev) => prev + 1);
  };

  const modeColor = MODE_COLORS[mode];
  const visibleLiveMessages = liveMessages
    .map((message) => ({
      raw: message,
      parsed: parseLiveAnalysis(message.text),
    }))
    .filter(
      (message) => !message.parsed || message.parsed.verdict !== "NO_CLAIM",
    )
    .reverse();

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
              {context.tab && (
                <>
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

      {/* Live audio analysis panel (video mode) */}
      {mode === "video" && (
        <div className="live-analysis-bar no-drag">
          {!audioCaptureRequested ? (
            <button
              className="live-analysis-action"
              onClick={handleStartSystemAudio}
            >
              Start System Audio
            </button>
          ) : audioError ? (
            <>
              <span className="live-analysis-error">⚠ {audioError}</span>
              <button
                className="live-analysis-action"
                onClick={handleStartSystemAudio}
              >
                Retry
              </button>
            </>
          ) : visibleLiveMessages.length === 0 ? (
            <span className="live-analysis-waiting">🎙 Listening…</span>
          ) : (
            <div className="live-analysis-feed">
              {visibleLiveMessages.map(({ raw, parsed }) =>
                parsed ? (
                  <button
                    key={raw.timestamp}
                    type="button"
                    className="live-analysis-card"
                    title={parsed.explanation}
                  >
                    <div className="live-analysis-header">
                      <span
                        className="live-analysis-verdict"
                        style={{
                          color: verdictColor(parsed.verdict, parsed.alarm),
                        }}
                      >
                        {parsed.alarm ? "ALERT" : parsed.verdict}
                      </span>
                      <span className="live-analysis-confidence">
                        {(parsed.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    {parsed.claim ? (
                      <p className="live-analysis-claim">{parsed.claim}</p>
                    ) : null}
                    <p className="live-analysis-explanation">
                      {parsed.explanation}
                    </p>
                    {/* <p className="live-analysis-transcript">
                      “{parsed.transcript}”
                    </p> */}
                  </button>
                ) : (
                  <div key={raw.timestamp} className="live-analysis-card">
                    <p className="live-analysis-text">{raw.text}</p>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      )}

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
