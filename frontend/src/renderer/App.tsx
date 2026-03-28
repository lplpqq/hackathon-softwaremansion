import { useEffect, useState } from "react";
import type { FullContext, DetectionMode } from "./types";

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

export default function App() {
  const [context, setContext] = useState<FullContext | null>(null);
  const [opacity, setOpacity] = useState(0.9);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onContextUpdate((ctx) => {
      setContext(ctx);
    });
    return unsubscribe;
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
        <div
          className="mode-badge"
          style={{ backgroundColor: modeColor }}
        >
          {MODE_LABELS[mode]}
        </div>
      </div>

      {/* Content */}
      <div className="overlay-content">
        {context ? (
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
