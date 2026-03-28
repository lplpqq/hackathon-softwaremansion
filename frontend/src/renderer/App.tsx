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
type LiveVerdict = "FACT" | "OPINION" | "UNSURE";

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
      setView("analysis");
    });
    return () => {
      unsubCtx();
      unsubAnalysis();
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
  const latestLiveMessage = liveMessages[0];
  const parsedLiveAnalysis = latestLiveMessage
    ? parseLiveAnalysis(latestLiveMessage.text)
    : null;

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
      {analysis && (
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
          analysis && (
            <>
              {/* Credibility score */}
              <div className="analysis-section">
                <span className="label">Credibility</span>
                <div className="score-row">
                  <div className="score-bar-track">
                    <div
                      className="score-bar-fill"
                      style={{
                        width: `${analysis.source_credibility_score * 100}%`,
                        backgroundColor: scoreColor(
                          analysis.source_credibility_score,
                        ),
                      }}
                    />
                  </div>
                  <span
                    className="score-value"
                    style={{
                      color: scoreColor(analysis.source_credibility_score),
                    }}
                  >
                    {(analysis.source_credibility_score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Publisher */}
              <div className="analysis-section">
                <span className="label">Publisher</span>
                <p className="analysis-text">
                  {analysis.publisher_description}
                </p>
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
                          <p className="manipulation-quote">"{chunk.quote}"</p>
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
          )
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
          ) : liveMessages.length === 0 ? (
            <span className="live-analysis-waiting">🎙 Listening…</span>
          ) : parsedLiveAnalysis ? (
            <div className="live-analysis-card">
              <div className="live-analysis-header">
                <span
                  className="live-analysis-verdict"
                  style={{
                    color: verdictColor(
                      parsedLiveAnalysis.verdict,
                      parsedLiveAnalysis.alarm,
                    ),
                  }}
                >
                  {parsedLiveAnalysis.alarm
                    ? "ALERT"
                    : parsedLiveAnalysis.verdict}
                </span>
                <span className="live-analysis-confidence">
                  {(parsedLiveAnalysis.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <p className="live-analysis-claim">{parsedLiveAnalysis.claim}</p>
              <p className="live-analysis-explanation">
                {parsedLiveAnalysis.explanation}
              </p>
              <p className="live-analysis-transcript">
                “{parsedLiveAnalysis.transcript}”
              </p>
            </div>
          ) : (
            <p className="live-analysis-text">{latestLiveMessage?.text}</p>
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
